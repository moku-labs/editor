/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import type { Server, ServerWebSocket } from "bun";
import type {
  Json,
  Manifest,
  Notification,
  Request as RpcRequest,
  Response as RpcResponse,
  SessionInfo,
  WireError
} from "../../../registry/protocol";
import {
  decode,
  encode,
  failure,
  isRequest,
  isResponse,
  notification,
  request as rpcRequest,
  success,
  toWireValue
} from "../../../registry/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// A minimal hub on a real Bun.serve: hello route, token + kind + Origin checks
// on upgrade, the editor-channel notifications, game and files answers.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-connection data of a tools socket. */
type ToolsData = { readonly token: string };

/** One stored file. */
type StoredFile = { text: string; version: string };

/** The fake hub the integration test drives. */
export type FakeHub = {
  readonly port: number;
  /** http origin of the server. */
  readonly origin: string;
  /** Socket URL without the query. */
  readonly ws: string;
  /** The token the upgrade accepts. */
  token: string;
  /** Number of GET /__editor/hello. */
  helloHits: number;
  /** Tokens of accepted upgrades. */
  readonly upgrades: string[];
  /** The `role` query of each accepted upgrade; null without one. */
  readonly roles: (string | null)[];
  /** Every notification a tools socket sent. */
  readonly notes: Notification[];
  /** Every request a tools socket sent. */
  readonly received: RpcRequest[];
  /** Close codes of tools sockets. */
  readonly closes: number[];
  /** Open tools sockets. */
  readonly sockets: Set<ServerWebSocket<ToolsData>>;
  /** Sessions announced to tools. */
  sessions: SessionInfo[];
  readonly manifests: Map<string, Manifest>;
  /** Value of each source id, sent first on watch and answered on read. */
  readonly values: Map<string, Json>;
  readonly files: Map<string, StoredFile>;
  /** Source ids whose read never answers. */
  readonly hang: Set<string>;
  /** Sends a notification to every tools socket. */
  notify(channel: "editor" | "game", method: string, params?: Json, session?: string): void;
  /** Opens a session: `session {open: true}` then `sessions {list}`. */
  open(info: SessionInfo, manifest: Manifest): void;
  /** Closes a session: `session {open: false, reason}` then `sessions {list}`. */
  close(id: string, reason: "bye" | "game_reloaded"): void;
  /** Forwards a heartbeat of a session. */
  heartbeat(session: string, frame: number, paused: boolean): void;
  /** Requests of one method. */
  requests(method: string): RpcRequest[];
  /** Sends an editor-channel request to every tools socket; resolves with the first answer. */
  ask(method: string, params?: Json): Promise<RpcResponse>;
  stop(): Promise<void>;
};

/**
 * Builds the answer of one request, or undefined for no answer.
 *
 * @param hub - The hub.
 * @param request - The request.
 * @param reply - Sends a message to the requesting socket.
 * @returns The response, or undefined.
 */
function answer(
  hub: FakeHub,
  request: RpcRequest,
  reply: (text: string) => void
): { result: Json } | { error: WireError } | undefined {
  const params = request.params;
  const object =
    typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
  const text = (key: string): string => {
    const value = object[key];
    return typeof value === "string" ? value : "";
  };

  if (request.channel === "files") return answerFiles(hub, request.method, text);

  const session = request.session ?? "";
  switch (request.method) {
    case "manifest": {
      const manifest = hub.manifests.get(session);
      return manifest === undefined
        ? { error: { code: -32_003, message: "[moku-editor] no session" } }
        : { result: toWireValue(manifest) };
    }
    case "read": {
      if (hub.hang.has(text("id"))) return undefined;
      return { result: hub.values.get(text("id")) ?? null };
    }
    case "watch": {
      const sub = object.sub;
      const value = hub.values.get(text("id"));
      if (value !== undefined && typeof sub === "number") {
        reply(encode(notification("game", "value", { sub, value }, session)));
      }
      return { result: null };
    }
    case "unwatch": {
      return { result: null };
    }
    default: {
      return { result: { value: null, state: { path: "home", frame: 1, tainted: false } } };
    }
  }
}

/**
 * Answers a files-channel request from the in-memory store.
 *
 * @param hub - The hub.
 * @param method - The files method.
 * @param text - Reads a string param.
 * @returns The response.
 */
function answerFiles(
  hub: FakeHub,
  method: string,
  text: (key: string) => string
): { result: Json } | { error: WireError } {
  const path = text("path");
  const stored = hub.files.get(path);

  if (method === "write" || method === "writeBinary") {
    const version = text("version");
    if (version !== "" && stored !== undefined && stored.version !== version) {
      return {
        error: {
          code: -32_005,
          message: `[moku-editor] version conflict: ${path}`,
          data: { reason: "version_conflict", retryable: false }
        }
      };
    }
    const body = method === "write" ? text("text") : text("data");
    const next = { text: body, version: `v${hub.files.size + 1}-${body.length}` };
    hub.files.set(path, next);
    return { result: { path, bytes: body.length, version: next.version } };
  }
  if (stored === undefined) {
    return { error: { code: -32_004, message: `[moku-editor] forbidden path: ${path}` } };
  }
  return method === "readBinary"
    ? { result: { dataUrl: stored.text, version: stored.version } }
    : { result: { text: stored.text, version: stored.version } };
}

/**
 * Starts the fake hub on 127.0.0.1 and a random port.
 *
 * @param token - The token the upgrade accepts.
 * @returns The hub.
 */
export function startFakeHub(token: string): FakeHub {
  let server: Server<ToolsData> | undefined;
  const sockets = new Set<ServerWebSocket<ToolsData>>();
  const broadcast = (text: string): void => {
    for (const socket of sockets) socket.send(text);
  };
  const asks = new Map<number, (response: RpcResponse) => void>();
  let nextAsk = 9000;

  const hub: FakeHub = {
    get port() {
      return server?.port ?? 0;
    },
    get origin() {
      return `http://127.0.0.1:${hub.port}`;
    },
    get ws() {
      return `ws://127.0.0.1:${hub.port}/__editor/ws`;
    },
    token,
    helloHits: 0,
    upgrades: [],
    roles: [],
    notes: [],
    received: [],
    closes: [],
    sockets,
    sessions: [],
    manifests: new Map(),
    values: new Map(),
    files: new Map(),
    hang: new Set(),
    notify(channel, method, params, session) {
      broadcast(encode(notification(channel, method, params, session)));
    },
    open(info, manifest) {
      hub.sessions = [...hub.sessions, info];
      hub.manifests.set(info.id, manifest);
      hub.notify("editor", "session", { id: info.id, game: info.game, open: true });
      hub.notify("editor", "sessions", { list: toWireValue(hub.sessions) });
    },
    close(id, reason) {
      hub.sessions = hub.sessions.filter(session => session.id !== id);
      hub.notify("editor", "session", { id, game: "merge-game", open: false, reason });
      hub.notify("editor", "sessions", { list: toWireValue(hub.sessions) });
    },
    heartbeat(session, frame, paused) {
      hub.notify("game", "heartbeat", { frame, paused, at: frame }, session);
    },
    requests(method) {
      return hub.received.filter(request => request.method === method);
    },
    ask(method, params) {
      nextAsk += 1;
      const id = nextAsk;
      const answered = new Promise<RpcResponse>(resolve => {
        asks.set(id, resolve);
      });
      broadcast(encode(rpcRequest(id, "editor", method, params)));
      return answered;
    },
    async stop() {
      for (const socket of sockets) socket.close(1001, "hub stop");
      // Bun 1.3.14: stop(true) never settles while a client close is still in flight.
      await Bun.sleep(20);
      await Promise.race([server?.stop(true), Bun.sleep(500)]);
    }
  };

  server = Bun.serve<ToolsData>({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request, bunServer) {
      const url = new URL(request.url);
      if (url.pathname === "/__editor/hello") {
        hub.helloHits += 1;
        return Response.json({ ws: hub.ws, token: hub.token });
      }
      if (url.pathname !== "/__editor/ws") return new Response("not found", { status: 404 });
      if (request.headers.get("origin") !== hub.origin)
        return new Response("origin", { status: 403 });
      if (url.searchParams.get("kind") !== "tools") return new Response("kind", { status: 400 });
      const given = url.searchParams.get("token") ?? "";
      if (given !== hub.token) return new Response("token", { status: 401 });
      hub.upgrades.push(given);
      hub.roles.push(url.searchParams.get("role"));
      return bunServer.upgrade(request, { data: { token: given } })
        ? undefined
        : new Response("upgrade failed", { status: 500 });
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
        socket.send(
          encode(notification("editor", "sessions", { list: toWireValue(hub.sessions) }))
        );
      },
      message(socket, message) {
        const decoded = decode(String(message));
        if (isResponse(decoded)) {
          asks.get(decoded.id)?.(decoded);
          asks.delete(decoded.id);
          return;
        }
        if (!isRequest(decoded)) {
          hub.notes.push(decoded);
          return;
        }
        hub.received.push(decoded);
        const response = answer(hub, decoded, text => socket.send(text));
        if (response === undefined) return;
        socket.send(
          encode(
            "result" in response
              ? success(decoded.id, response.result)
              : failure(decoded.id, response.error)
          )
        );
      },
      close(socket, code) {
        sockets.delete(socket);
        hub.closes.push(code);
      }
    }
  });

  return hub;
}
