/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type {
  Json,
  Manifest,
  Request as RpcRequest,
  SessionInfo
} from "../../../registry/protocol";
import {
  decode,
  encode,
  errorCode,
  failure,
  isRequest,
  notification,
  success,
  toWireError,
  toWireValue,
  wireError
} from "../../../registry/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// An in-process hub behind a fake WebSocket class: link connects to it like to
// the real hub. Game-channel reads answer from a value map; a watch delivers
// the current value, then every push of that id. Messages arrive on a
// microtask. Only the game and editor channels are served.
// ─────────────────────────────────────────────────────────────────────────────

/** What a socket listener receives. */
type SocketEvent = { readonly data?: string; readonly code?: number; readonly reason?: string };

/** The hub. */
export type TestHub = {
  readonly Socket: new (url: string, ...rest: unknown[]) => WebSocket;
  /** Every request link sent. */
  readonly received: RpcRequest[];
  /** Current value of each source id. */
  readonly values: Map<string, Json>;
  /** Source id of every watch sub. */
  readonly subs: Map<number, string>;
  /** Opens a session: `session {open: true}`, then `sessions {list}`. */
  open(info: SessionInfo, manifest: Manifest): void;
  /** Closes a session: `session {open: false, reason}`, then `sessions {list}`. */
  close(id: string, reason: string): void;
  /** Sends a heartbeat of the open session. */
  heartbeat(frame: number): void;
  /** Sets a source value and sends it to every watch of the id. */
  push(id: string, value: Json): void;
  /** Requests of one method. */
  requests(method: string): RpcRequest[];
  /** Source ids of the subs of every request of one method. */
  watchedIds(method: "watch" | "unwatch"): string[];
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
 * Creates the hub.
 *
 * @returns The hub.
 */
export function createTestHub(): TestHub {
  const sockets: Socket[] = [];
  const subs = new Map<number, string>();
  const active = new Set<number>();
  const values = new Map<string, Json>();
  let sessions: SessionInfo[] = [];
  let manifest: Manifest | undefined;
  let session: string | undefined;

  const notify = (channel: "editor" | "game", method: string, params: Json, id?: string): void => {
    const message = encode(notification(channel, method, params, id));
    for (const socket of sockets) socket.deliver(message);
  };

  const answerGame = (request: RpcRequest): Json => {
    const params = paramsOf(request);
    const id = typeof params.id === "string" ? params.id : "";
    switch (request.method) {
      case "manifest": {
        return toWireValue(manifest ?? null);
      }
      case "read": {
        const value = values.get(id);
        if (value === undefined)
          throw wireError(errorCode.unknownMethod, `[moku-editor] Unknown source ${id}.`);
        return value;
      }
      case "watch": {
        const sub = Number(params.sub);
        subs.set(sub, id);
        active.add(sub);
        const value = values.get(id) ?? null;
        queueMicrotask(() => notify("game", "value", { sub, value }, session));
        return null;
      }
      case "unwatch": {
        active.delete(Number(params.sub));
        return null;
      }
      default: {
        throw wireError(errorCode.unknownMethod, `[moku-editor] Unknown command ${id}.`);
      }
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
      let reply: string;
      try {
        reply = encode(success(decoded.id, answerGame(decoded)));
      } catch (error) {
        reply = encode(failure(decoded.id, toWireError(error)));
      }
      this.deliver(reply);
    }

    close(code = 1000, reason = ""): void {
      if (this.closed) return;
      this.closed = true;
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
    values,
    subs,
    open(info, next) {
      sessions = [...sessions, info];
      manifest = next;
      session = info.id;
      notify("editor", "session", { id: info.id, game: info.game, open: true });
      notify("editor", "sessions", { list: toWireValue(sessions) });
    },
    close(id, reason) {
      sessions = sessions.filter(item => item.id !== id);
      active.clear();
      notify("editor", "session", { id, game: "merge-game", open: false, reason });
      notify("editor", "sessions", { list: toWireValue(sessions) });
    },
    heartbeat(frame) {
      notify("game", "heartbeat", { frame, paused: false, at: frame }, session);
    },
    push(id, value) {
      values.set(id, value);
      for (const [sub, subId] of subs) {
        if (subId === id && active.has(sub)) notify("game", "value", { sub, value }, session);
      }
    },
    requests(method) {
      return hub.received.filter(request => request.method === method);
    },
    watchedIds(method) {
      return hub
        .requests(method)
        .map(request =>
          method === "watch" ? paramsOf(request).id : subs.get(Number(paramsOf(request).sub))
        )
        .filter(id => typeof id === "string");
    }
  };
  return hub;
}
