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
// A scripted hub behind a fake WebSocket (no network) for the flowView
// integration: the game channel answers watches with values the test sends,
// runs with a RunResult, reads from a value map; the files channel works on an
// in-memory project (versions, -32005 conflicts, -32601 for a missing file).
// ─────────────────────────────────────────────────────────────────────────────

/** What a socket listener receives. */
type SocketEvent = { readonly data?: string; readonly code?: number; readonly reason?: string };

/** One fake socket. */
type HubSocket = { closed: boolean; deliver(text: string): void };

/** The flowView hub. */
export type FlowHub = {
  readonly Socket: new (url: string, ...rest: unknown[]) => WebSocket;
  readonly received: RpcRequest[];
  /** Project files: path → text and version. */
  readonly files: Map<string, { text: string; version: string }>;
  /** Values of one-shot reads by source id. */
  readonly reads: Map<string, Json>;
  frame: number;
  open(info: SessionInfo, manifest: Manifest): void;
  close(id: string, reason: string): void;
  heartbeat(session: string, frame: number, paused: boolean): void;
  /** Sends a value to the last watch of a source id. */
  value(session: string, id: string, value: Json): void;
  watches(id: string): number[];
  runs(id?: string): RpcRequest[];
  writes(path?: string): RpcRequest[];
};

/**
 * The params object of a request.
 *
 * @param request - The request.
 * @returns Its params.
 */
function paramsOf(request: RpcRequest): { readonly [key: string]: Json } {
  const { params } = request;
  return typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
}

/** A failure answer. */
function fail(request: RpcRequest, error: WireError): string {
  return encode(failure(request.id, error));
}

/** Creates the hub. */
export function createFlowHub(): FlowHub {
  const sockets: HubSocket[] = [];
  let version = 1;
  const broadcast = (text: string): void => {
    for (const socket of sockets) if (!socket.closed) socket.deliver(text);
  };
  const notify = (channel: "editor" | "game", method: string, params: Json, session?: string) => {
    broadcast(encode(notification(channel, method, params, session)));
  };
  const sessions: SessionInfo[] = [];
  const manifests = new Map<string, Manifest>();

  const writeAnswer = (
    request: RpcRequest,
    path: string,
    params: { readonly [key: string]: Json }
  ): string => {
    const text = typeof params.text === "string" ? params.text : "";
    const current = hub.files.get(path);
    if (typeof params.version === "string" && current?.version !== params.version) {
      return fail(request, {
        code: -32_005,
        message: `[moku-editor] version conflict: ${path}`,
        data: { reason: "version_conflict", retryable: false }
      });
    }
    version += 1;
    hub.files.set(path, { text, version: `v${version}` });
    return encode(success(request.id, { path, bytes: text.length, version: `v${version}` }));
  };

  const filesAnswer = (request: RpcRequest): string => {
    const params = paramsOf(request);
    const path = typeof params.path === "string" ? params.path : "";
    if (request.method === "list") {
      const dir = typeof params.dir === "string" ? params.dir : "";
      const prefix = dir === "" ? "" : `${dir}/`;
      const entries = [...hub.files.entries()]
        .filter(([file]) => file.startsWith(prefix) && !file.slice(prefix.length).includes("/"))
        .map(([file, entry]) => ({
          path: file,
          kind: "file",
          size: entry.text.length,
          version: entry.version
        }));
      return encode(success(request.id, entries));
    }
    if (request.method === "read") {
      const file = hub.files.get(path);
      if (file === undefined) {
        return fail(request, {
          code: -32_601,
          message: `[moku-editor] not found: ${path}`,
          data: { reason: "unknown_id" }
        });
      }
      return encode(success(request.id, { text: file.text, version: file.version }));
    }
    if (request.method === "write") return writeAnswer(request, path, params);
    if (request.method === "readBinary") {
      return encode(success(request.id, { dataUrl: "data:image/png;base64,AA==", version: "b1" }));
    }
    return encode(success(request.id, null));
  };

  const gameAnswer = (request: RpcRequest): string => {
    const params = paramsOf(request);
    if (request.method === "manifest") {
      const manifest = manifests.get(request.session ?? "");
      return manifest === undefined
        ? fail(request, { code: -32_003, message: "[moku-editor] no session" })
        : encode(success(request.id, toWireValue(manifest)));
    }
    if (request.method === "read") {
      const id = typeof params.id === "string" ? params.id : "";
      return encode(success(request.id, hub.reads.get(id) ?? null));
    }
    if (request.method === "run") {
      const state = { path: "board/awaitIntent", frame: hub.frame, tainted: false };
      return encode(success(request.id, { value: null, state }));
    }
    return encode(success(request.id, null));
  };

  /** The fake WebSocket. */
  class Socket extends EventTarget implements HubSocket {
    closed = false;

    constructor() {
      super();
      sockets.push(this);
      queueMicrotask(() => {
        this.#fire("open", {});
        notify("editor", "sessions", { list: toWireValue(sessions) });
      });
    }

    send(text: string): void {
      const message = decode(text);
      if (!isRequest(message)) return;
      hub.received.push(message);
      this.deliver(message.channel === "files" ? filesAnswer(message) : gameAnswer(message));
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

  const hub: FlowHub = {
    Socket: Socket as unknown as FlowHub["Socket"],
    received: [],
    files: new Map(),
    reads: new Map(),
    frame: 1,
    open(info, manifest) {
      sessions.push(info);
      manifests.set(info.id, manifest);
      notify("editor", "session", { id: info.id, game: info.game, open: true });
      notify("editor", "sessions", { list: toWireValue(sessions) });
    },
    close(id, reason) {
      const index = sessions.findIndex(session => session.id === id);
      if (index !== -1) sessions.splice(index, 1);
      notify("editor", "session", { id, game: "merge-game", open: false, reason });
      notify("editor", "sessions", { list: toWireValue(sessions) });
    },
    heartbeat(session, frame, paused) {
      hub.frame = frame;
      notify("game", "heartbeat", { frame, paused, at: frame }, session);
    },
    value(session, id, value) {
      const sub = hub.watches(id).at(-1) ?? -1;
      notify("game", "value", { sub, value }, session);
    },
    watches(id) {
      return hub.received
        .filter(request => request.method === "watch" && paramsOf(request).id === id)
        .map(request => Number(paramsOf(request).sub));
    },
    runs(id) {
      return hub.received.filter(
        request => request.method === "run" && (id === undefined || paramsOf(request).id === id)
      );
    },
    writes(path) {
      return hub.received.filter(
        request =>
          request.channel === "files" &&
          request.method === "write" &&
          (path === undefined || paramsOf(request).path === path)
      );
    }
  };
  return hub;
}
