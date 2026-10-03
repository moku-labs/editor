/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type {
  EditorChannel,
  Json,
  Manifest,
  Request as RpcRequest,
  SessionInfo
} from "../../../registry/protocol";
import {
  decode,
  encode,
  failure,
  isRequest,
  notification,
  success,
  toWireError,
  toWireValue
} from "../../../registry/protocol";
import type { FilesStore } from "../files-store";

// ─────────────────────────────────────────────────────────────────────────────
// An in-process hub behind a fake WebSocket class: link connects to it like to
// the real hub. Game-channel requests go to a backend with the EditorChannel
// shape (a scripted one, or the agent channel over merge-game); files-channel
// requests go to the in-memory files store. Messages arrive on a microtask.
// ─────────────────────────────────────────────────────────────────────────────

/** What the hub needs of the game side. */
export type HubBackend = Pick<EditorChannel, "read" | "watch" | "run">;

/** What a socket listener receives. */
type SocketEvent = { readonly data?: string; readonly code?: number; readonly reason?: string };

/** The hub. */
export type TestHub = {
  readonly Socket: new (url: string, ...rest: unknown[]) => WebSocket;
  /** Every request link sent. */
  readonly received: RpcRequest[];
  /** Opens a session: `session {open: true}`, then `sessions {list}`. */
  open(info: SessionInfo, manifest: Manifest): void;
  /** Sends a heartbeat of the open session. */
  heartbeat(frame: number): void;
  /** Requests of a method, optionally of one channel. */
  requests(method: string, channel?: "game" | "files"): RpcRequest[];
  /** The source id of every watch sub. */
  readonly subs: Map<number, string>;
};

/**
 * The params object of a request.
 *
 * @param request - The request.
 * @returns Its params as an object.
 */
export function paramsOf(request: RpcRequest): { readonly [key: string]: Json } {
  const { params } = request;
  return typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
}

/**
 * A string field of a params object.
 *
 * @param params - The params.
 * @param key - The field.
 * @returns The string, "" when absent.
 */
function text(params: { readonly [key: string]: Json }, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

/**
 * Creates the hub.
 *
 * @param backend - The game side.
 * @param files - The files store.
 * @returns The hub.
 */
export function createTestHub(backend: HubBackend, files: FilesStore): TestHub {
  const sockets: Socket[] = [];
  const unwatches = new Map<number, () => void>();
  const subs = new Map<number, string>();
  let sessions: SessionInfo[] = [];
  let manifest: Manifest | undefined;
  let session: string | undefined;

  const broadcast = (message: string): void => {
    for (const socket of sockets) socket.deliver(message);
  };
  const notify = (channel: "editor" | "game", method: string, params: Json, id?: string): void => {
    broadcast(encode(notification(channel, method, params, id)));
  };

  const answerFiles = async (request: RpcRequest): Promise<Json> => {
    const params = paramsOf(request);
    switch (request.method) {
      case "list": {
        return toWireValue(await files.list(text(params, "dir")));
      }
      case "read": {
        return toWireValue(await files.read(text(params, "path")));
      }
      case "write": {
        const version = params.version;
        return toWireValue(
          await files.write(
            text(params, "path"),
            text(params, "text"),
            typeof version === "string" ? version : undefined
          )
        );
      }
      case "writeBinary": {
        return toWireValue(await files.writeBinary(text(params, "path"), text(params, "data")));
      }
      default: {
        return toWireValue(await files.readBinary(text(params, "path")));
      }
    }
  };

  const answerGame = async (request: RpcRequest): Promise<Json> => {
    const params = paramsOf(request);
    switch (request.method) {
      case "manifest": {
        return toWireValue(manifest ?? null);
      }
      case "read": {
        return backend.read(text(params, "id"), params.input);
      }
      case "watch": {
        const sub = Number(params.sub);
        const id = text(params, "id");
        subs.set(sub, id);
        unwatches.set(
          sub,
          backend.watch(id, params.input, value => notify("game", "value", { sub, value }, session))
        );
        return null;
      }
      case "unwatch": {
        const sub = Number(params.sub);
        unwatches.get(sub)?.();
        unwatches.delete(sub);
        return null;
      }
      default: {
        const ran = await backend.run(text(params, "id"), params.input);
        return toWireValue(ran);
      }
    }
  };

  const answer = async (request: RpcRequest): Promise<string> => {
    try {
      const result =
        request.channel === "files" ? await answerFiles(request) : await answerGame(request);
      return encode(success(request.id, result));
    } catch (error) {
      return encode(failure(request.id, toWireError(error)));
    }
  };

  /** The fake WebSocket. */
  class Socket extends EventTarget {
    readonly url: string;
    closed = false;

    constructor(url: string) {
      super();
      this.url = url;
      sockets.push(this);
      queueMicrotask(() => {
        this.#fire("open", {});
        notify("editor", "sessions", { list: toWireValue(sessions) });
      });
    }

    send(message: string): void {
      const decoded = decode(message);
      if (!isRequest(decoded)) return;
      hub.received.push(decoded);
      answer(decoded).then(
        reply => this.deliver(reply),
        () => undefined
      );
    }

    close(code = 1000, reason = ""): void {
      if (this.closed) return;
      this.closed = true;
      for (const unwatch of unwatches.values()) unwatch();
      unwatches.clear();
      queueMicrotask(() => this.#fire("close", { code, reason }));
    }

    deliver(message: string): void {
      queueMicrotask(() => {
        if (!this.closed) this.#fire("message", { data: message });
      });
    }

    #fire(type: string, init: SocketEvent): void {
      this.dispatchEvent(Object.assign(new Event(type), init));
    }
  }

  const hub: TestHub = {
    Socket: Socket as unknown as TestHub["Socket"],
    received: [],
    subs,
    open(info, next) {
      sessions = [...sessions, info];
      manifest = next;
      session = info.id;
      notify("editor", "session", { id: info.id, game: info.game, open: true });
      notify("editor", "sessions", { list: toWireValue(sessions) });
    },
    heartbeat(frame) {
      notify("game", "heartbeat", { frame, paused: false, at: frame }, session);
    },
    requests(method, channel) {
      return hub.received.filter(
        request =>
          request.method === method && (channel === undefined || request.channel === channel)
      );
    }
  };
  return hub;
}
