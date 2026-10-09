/**
 * @file pages/mcp — the bridge's hub tools connection (M2): `${ws}?token=…&kind=tools` with the
 * Origin header `http://127.0.0.1:<port>` so the hub guard passes, JSON-RPC ids, the `sessions`
 * list with the live heartbeats, `editor.hotReload`, game, files and editor requests, and
 * `watch`/`value`/`unwatch`. The token is never logged, and neither is the URL that carries it.
 */
import type { Channel, Json, Message, Notification, SessionInfo } from "../../registry/protocol";
import {
  decode,
  encode,
  errorCode,
  fromWireError,
  isFailure,
  isNotification,
  request as requestMessage,
  wireError
} from "../../registry/protocol";
import type { EditorDiscovery } from "../types";
import { isObject } from "./rpc";
import { readBeat, readSessionList } from "./shapes";
import type { HubClient, SessionView, WatchTarget } from "./types";

/**
 * How long the connection waits for the hub's first `sessions` notification.
 */
const READY_TIMEOUT_MS = 5000;

/**
 * The bridge's own deadline of one request (the hub has its own, shorter one for game calls).
 */
const REQUEST_TIMEOUT_MS = 70_000;

/**
 * Normal websocket close.
 */
const NORMAL_CLOSE = 1000;

/**
 * Opens a websocket with an Origin header.
 */
export type OpenSocket = (url: string, origin: string) => WebSocket;

/**
 * Options of `connectHub`.
 */
export type HubClientOptions = {
  /** Called once when the socket closes without `close()` (the bin stopped or restarted). */
  readonly onClose?: () => void;
  /** The socket factory (default: Bun's WebSocket with `{ headers: { origin } }`). */
  readonly openSocket?: OpenSocket;
  /** The wait for the first `sessions` notification. */
  readonly readyTimeoutMs?: number;
  /** The bridge's deadline of one request. */
  readonly requestTimeoutMs?: number;
};

/**
 * One request in flight.
 */
type Pending = {
  readonly resolve: (value: Json) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

/**
 * The mutable state of one connection.
 */
type ClientState = {
  open: boolean;
  closedByUs: boolean;
  nextId: number;
  nextSub: number;
  readonly pending: Map<number, Pending>;
  readonly subs: Map<number, (value: Json) => void>;
  sessions: SessionInfo[];
  readonly beats: Map<string, { readonly frame: number; readonly paused: boolean }>;
  hotReload: Json | undefined;
  readonly listeners: Set<(list: readonly SessionView[]) => void>;
};

/**
 * Bun's WebSocket with client headers. The DOM typing of the constructor does not know Bun's
 * options object, so it is built through Reflect.
 *
 * @param url - The upgrade URL with its query.
 * @param origin - The Origin header.
 * @returns The socket.
 * @example
 * ```ts
 * const socket = bunSocket(`${bin.ws}?token=${token}&kind=tools`, bin.url);
 * ```
 */
function bunSocket(url: string, origin: string): WebSocket {
  return Reflect.construct(WebSocket, [url, { headers: { origin } }]);
}

/**
 * The error of a call when the connection closed.
 *
 * @returns A retryable `link_closed` wire error.
 * @example
 * ```ts
 * pending.reject(linkClosed());
 * ```
 */
function linkClosed(): Error {
  return wireError(errorCode.timeout, "the connection to moku-editor closed.", {
    reason: "link_closed",
    retryable: true
  });
}

/**
 * The error of a call past the bridge's deadline.
 *
 * @param ms - The deadline.
 * @returns A retryable `timeout` wire error.
 * @example
 * ```ts
 * pending.reject(tooSlow(70_000));
 * ```
 */
function tooSlow(ms: number): Error {
  return wireError(errorCode.timeout, `moku-editor did not answer in ${String(ms / 1000)} s.`, {
    reason: "timeout",
    retryable: true
  });
}

/**
 * The view of the sessions: each one with the latest heartbeat seen, from the list or from a
 * forwarded `game.heartbeat`, and the hub's silent flag.
 *
 * @param state - The connection state.
 * @returns A fresh list.
 * @example
 * ```ts
 * sessionViews(state); // [{ id: "s-1", …, heartbeat: { frame: 1840, paused: false, silent: false } }]
 * ```
 */
function sessionViews(state: ClientState): SessionView[] {
  return state.sessions.map(info => {
    const { heartbeat, ...fields } = info;
    const beat = state.beats.get(info.id);
    if (beat === undefined) return fields;
    return { ...fields, heartbeat: { ...beat, silent: heartbeat?.silent ?? false } };
  });
}

/**
 * Takes a new `sessions` list: the readouts it carries are the newest beats.
 *
 * @param state - The connection state.
 * @param list - The sessions.
 */
function takeSessions(state: ClientState, list: SessionInfo[]): void {
  state.sessions = list;
  for (const id of state.beats.keys()) {
    if (!list.some(info => info.id === id)) state.beats.delete(id);
  }
  for (const info of list) {
    if (info.heartbeat !== undefined) {
      const { frame, paused } = info.heartbeat;
      state.beats.set(info.id, { frame, paused });
    }
  }
  const views = sessionViews(state);
  for (const listener of state.listeners) listener(views);
}

/**
 * One notification of the hub: sessions, hot reload, a forwarded heartbeat or a watched value.
 *
 * @param state - The connection state.
 * @param note - The notification.
 * @param onReady - Called on every `sessions` list (the first one opens the connection).
 */
function onNotification(state: ClientState, note: Notification, onReady: () => void): void {
  const { channel, method, params } = note;
  if (channel === "editor" && method === "sessions") {
    const list = readSessionList(params);
    if (list === undefined) return;
    takeSessions(state, list);
    onReady();
    return;
  }
  if (channel === "editor" && method === "hotReload") {
    state.hotReload = params;
    return;
  }
  if (channel === "game" && method === "heartbeat" && note.session !== undefined) {
    const beat = readBeat(params);
    if (beat !== undefined) state.beats.set(note.session, beat);
    return;
  }
  if (channel === "game" && method === "value" && isObject(params)) {
    const { sub, value } = params;
    if (typeof sub === "number" && value !== undefined) state.subs.get(sub)?.(value);
  }
}

/**
 * One decoded message: a response settles its request, a notification updates the state.
 *
 * @param state - The connection state.
 * @param message - The decoded message.
 * @param onReady - Called on every `sessions` list.
 */
function onMessage(state: ClientState, message: Message, onReady: () => void): void {
  if (isNotification(message)) {
    onNotification(state, message, onReady);
    return;
  }
  if ("method" in message) return;

  const pending = state.pending.get(message.id);
  if (pending === undefined) return;
  state.pending.delete(message.id);
  clearTimeout(pending.timer);
  if (isFailure(message)) pending.reject(fromWireError(message.error));
  else pending.resolve(message.result);
}

/**
 * The socket closed: every pending call fails `link_closed` and every watch is dropped.
 *
 * @param state - The connection state.
 */
function onClosed(state: ClientState): void {
  state.open = false;
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(linkClosed());
  }
  state.pending.clear();
  state.subs.clear();
  state.listeners.clear();
}

/**
 * Builds the client over an open socket.
 *
 * @param bin - The bin it talks to.
 * @param socket - The socket.
 * @param state - The connection state.
 * @param requestTimeoutMs - The bridge's deadline of one request.
 * @returns The client.
 */
function clientOf(
  bin: EditorDiscovery,
  socket: WebSocket,
  state: ClientState,
  requestTimeoutMs: number
): HubClient {
  /**
   * Sends one request and waits for its response.
   *
   * @param channel - "game", "files" or "editor".
   * @param method - The method.
   * @param params - The params.
   * @param session - The session id, when one was asked for.
   * @returns The result.
   */
  function request(
    channel: Channel,
    method: string,
    params?: Json,
    session?: string
  ): Promise<Json> {
    if (!state.open) return Promise.reject(linkClosed());
    const id = state.nextId;
    state.nextId += 1;
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(tooSlow(requestTimeoutMs));
      }, requestTimeoutMs);
      state.pending.set(id, { resolve, reject, timer });
      socket.send(encode(requestMessage(id, channel, method, params, session)));
    });
  }

  /**
   * Watches a source; values go to `onValue` from the first one (the current value) on.
   *
   * @param target - The source, its input and the session.
   * @param onValue - Called with every value.
   * @returns The stop: drops the handler and sends `unwatch` once.
   */
  async function watch(target: WatchTarget, onValue: (value: Json) => void): Promise<() => void> {
    const sub = state.nextSub;
    state.nextSub += 1;
    state.subs.set(sub, onValue);
    try {
      await request("game", "watch", { sub, id: target.id, ...inputOf(target) }, target.session);
    } catch (error) {
      state.subs.delete(sub);
      throw error;
    }

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      state.subs.delete(sub);
      if (state.open) request("game", "unwatch", { sub }).catch(ignore);
    };
  }

  return {
    bin,
    request,
    watch,
    sessions: () => sessionViews(state),
    hotReload: () => state.hotReload,
    onSessions: listener => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    isOpen: () => state.open,
    close: () => {
      state.closedByUs = true;
      onClosed(state);
      socket.close(NORMAL_CLOSE, "bridge closing");
    }
  };
}

/**
 * The `input` member of a watch, only when there is one.
 *
 * @param target - The watch target.
 * @returns `{ input }` or `{}`.
 * @example
 * ```ts
 * inputOf({ id: "game.history", input: { last: 1 }, session: undefined }); // { input: { last: 1 } }
 * ```
 */
function inputOf(target: WatchTarget): { input?: Json } {
  return target.input === undefined ? {} : { input: target.input };
}

/**
 * Ignores the answer of a fire-and-forget request.
 */
function ignore(): void {
  // An unwatch that fails changes nothing: the watch is gone on this side.
}

/**
 * Opens the tools connection to a bin and waits for the hub's first `sessions` list.
 *
 * @param bin - The live discovery record.
 * @param options - Close callback, socket factory and deadlines.
 * @returns The connected client.
 * @throws {Error} `[moku-editor] could not connect …` when the socket closes or stays silent
 *   before the first list.
 * @example
 * ```ts
 * const hub = await connectHub(found.live, { onClose: () => reconnect() });
 * hub.sessions(); // [{ id: "s-7f3a", game: "merge-game 0.0.0", …, heartbeat: { frame: 1840, paused: false, silent: false } }]
 * ```
 */
export function connectHub(
  bin: EditorDiscovery,
  options: HubClientOptions = {}
): Promise<HubClient> {
  const state: ClientState = {
    open: false,
    closedByUs: false,
    nextId: 1,
    nextSub: 1,
    pending: new Map(),
    subs: new Map(),
    sessions: [],
    beats: new Map(),
    hotReload: undefined,
    listeners: new Set()
  };
  const url = `${bin.ws}?token=${encodeURIComponent(bin.token)}&kind=tools`;
  const socket = (options.openSocket ?? bunSocket)(url, bin.url);
  const client = clientOf(bin, socket, state, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);

  return new Promise<HubClient>((resolve, reject) => {
    let settled = false;
    let connected = false;
    const fail = (why: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`[moku-editor] could not connect to moku-editor at ${bin.url}: ${why}.`));
      socket.close(NORMAL_CLOSE, "bridge gave up");
    };
    const timer = setTimeout(
      () => fail("no sessions list"),
      options.readyTimeoutMs ?? READY_TIMEOUT_MS
    );
    const onReady = (): void => {
      if (settled) return;
      settled = true;
      connected = true;
      clearTimeout(timer);
      resolve(client);
    };

    socket.addEventListener("open", () => {
      state.open = true;
    });
    socket.addEventListener("message", event => {
      if (typeof event.data !== "string") return;
      try {
        onMessage(state, decode(event.data), onReady);
      } catch {
        // A frame the protocol refuses is dropped; the hub never sends one.
      }
    });
    socket.addEventListener("close", () => {
      onClosed(state);
      fail("the socket closed");
      if (connected && !state.closedByUs) options.onClose?.();
    });
  });
}
