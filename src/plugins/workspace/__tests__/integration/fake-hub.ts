/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type {
  Json,
  Manifest,
  Request as RpcRequest,
  SessionInfo,
  WireError
} from "../../../registry/protocol";
import {
  decode,
  encode,
  failure,
  isRequest,
  notification,
  success,
  toWireValue
} from "../../../registry/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// A scripted hub behind a fake WebSocket class (no network): link connects to
// it like to the real hub; the test opens and closes sessions, sends
// heartbeats and decides the answer of every `run`. Messages are delivered on
// a microtask, like a socket would. Reusable by the panels integration test.
// ─────────────────────────────────────────────────────────────────────────────

/** What a socket listener receives. */
type SocketEvent = { readonly data?: string; readonly code?: number; readonly reason?: string };

/** How the hub answers a `run`: a value, or a wire error. */
export type RunAnswer = { readonly value: Json } | { readonly error: WireError };

/** The scripted hub. */
export type ScriptedHub = {
  /** The fake WebSocket class to stub as the global `WebSocket`. */
  readonly Socket: new (
    url: string,
    ...rest: unknown[]
  ) => WebSocket;
  /** Sockets link opened. */
  readonly sockets: ScriptedSocket[];
  /** Every request link sent. */
  readonly received: RpcRequest[];
  /** Sessions announced to tools. */
  sessions: SessionInfo[];
  readonly manifests: Map<string, Manifest>;
  /** Answers of `run` by command id; others answer `{ value: null }`. */
  readonly answers: Map<string, (input: Json | undefined) => RunAnswer>;
  /** Frame of the run envelope. */
  frame: number;
  /** Opens a session: `session {open: true}` then `sessions {list}`. */
  open(info: SessionInfo, manifest: Manifest): void;
  /** Closes a session: `session {open: false, reason}` then `sessions {list}`. */
  close(id: string, reason: "bye" | "game_reloaded"): void;
  /** Forwards a heartbeat of a session. */
  heartbeat(session: string, frame: number, paused: boolean): void;
  /** `run` requests, optionally of one command id. */
  runs(id?: string): RpcRequest[];
};

/** One fake socket. */
type ScriptedSocket = {
  readonly url: string;
  closed: boolean;
  deliver(text: string): void;
};

/**
 * The params object of a request.
 *
 * @param request - The request.
 * @returns Its params as an object.
 */
function paramsOf(request: RpcRequest): { readonly [key: string]: Json } {
  const { params } = request;
  return typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
}

/**
 * Creates a scripted hub.
 *
 * @returns The hub.
 */
export function createScriptedHub(): ScriptedHub {
  const sockets: ScriptedSocket[] = [];
  const broadcast = (text: string): void => {
    for (const socket of sockets) if (!socket.closed) socket.deliver(text);
  };
  const notify = (channel: "editor" | "game", method: string, params: Json, session?: string) => {
    broadcast(encode(notification(channel, method, params, session)));
  };
  const sendSessions = (): void =>
    notify("editor", "sessions", { list: toWireValue(hub.sessions) });

  const answer = (request: RpcRequest): string | undefined => {
    const params = paramsOf(request);
    if (request.method === "manifest") {
      const manifest = hub.manifests.get(request.session ?? "");
      return manifest === undefined
        ? encode(failure(request.id, { code: -32_003, message: "[moku-editor] no session" }))
        : encode(success(request.id, toWireValue(manifest)));
    }
    if (request.method !== "run") return encode(success(request.id, null));

    const id = typeof params.id === "string" ? params.id : "";
    const reply = hub.answers.get(id)?.(params.input) ?? { value: null };
    if ("error" in reply) return encode(failure(request.id, reply.error));
    const state = { path: "board/awaitIntent", frame: hub.frame, tainted: false };
    return encode(success(request.id, { value: reply.value, state }));
  };

  /** The fake WebSocket. */
  class Socket extends EventTarget implements ScriptedSocket {
    readonly url: string;
    closed = false;

    constructor(url: string) {
      super();
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => {
        this.#fire("open", {});
        sendSessions();
      });
    }

    send(text: string): void {
      const message = decode(text);
      if (!isRequest(message)) return;
      hub.received.push(message);
      const reply = answer(message);
      if (reply !== undefined) this.deliver(reply);
    }

    close(code = 1000, reason = ""): void {
      if (this.closed) return;
      this.closed = true;
      queueMicrotask(() => this.#fire("close", { code, reason }));
    }

    deliver(text: string): void {
      queueMicrotask(() => {
        if (!this.closed) this.#fire("message", { data: text });
      });
    }

    #fire(type: string, init: SocketEvent): void {
      this.dispatchEvent(Object.assign(new Event(type), init));
    }
  }

  const hub: ScriptedHub = {
    Socket: Socket as unknown as ScriptedHub["Socket"],
    sockets,
    received: [],
    sessions: [],
    manifests: new Map(),
    answers: new Map(),
    frame: 1,
    open(info, manifest) {
      hub.sessions = [...hub.sessions, info];
      hub.manifests.set(info.id, manifest);
      notify("editor", "session", { id: info.id, game: info.game, open: true });
      sendSessions();
    },
    close(id, reason) {
      hub.sessions = hub.sessions.filter(session => session.id !== id);
      notify("editor", "session", { id, game: "merge-game", open: false, reason });
      sendSessions();
    },
    heartbeat(session, frame, paused) {
      hub.frame = frame;
      notify("game", "heartbeat", { frame, paused, at: frame }, session);
    },
    runs(id) {
      return hub.received.filter(
        request => request.method === "run" && (id === undefined || paramsOf(request).id === id)
      );
    }
  };
  return hub;
}
