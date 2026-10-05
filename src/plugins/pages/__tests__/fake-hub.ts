/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import type { ServerWebSocket } from "bun";
import type { Json, SessionInfo } from "../../registry/protocol";
import {
  decode,
  encode,
  failure,
  notification,
  success,
  toWireError
} from "../../registry/protocol";
import type { EditorDiscovery } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// A fake hub for the MCP bridge tests: a real Bun websocket server on
// 127.0.0.1 that checks the token, kind=tools and the Origin header like the
// hub guard, sends `sessions {list}` (and `hotReload`) on open, answers game
// and files requests from per-method handlers and records every request.
// ─────────────────────────────────────────────────────────────────────────────

/** The token of the fake hub. */
export const FAKE_TOKEN = "t".repeat(43);

/** One request the fake hub received. */
export type Received = {
  readonly channel: string;
  readonly method: string;
  readonly params: Json | undefined;
  readonly session: string | undefined;
};

/** Answers one request: a result, or a thrown wire error. */
export type Handler = (
  params: Json | undefined,
  session: string | undefined
) => Json | Promise<Json>;

/** The fake hub. */
export type FakeHub = {
  readonly port: number;
  readonly url: string;
  readonly requests: Received[];
  /** Origin headers of the upgrades, in order. */
  readonly origins: string[];
  /** Answers `<channel>.<method>` with the handler. */
  handle(key: string, handler: Handler): void;
  /** Sets the session list and sends it to every client. */
  setSessions(list: SessionInfo[]): void;
  /** Sends a notification to every client. */
  notify(channel: "game" | "editor", method: string, params: Json, session?: string): void;
  /** Sends a `value` notification for a watch sub. */
  value(sub: number, value: Json): void;
  /** The subs watched now. */
  watched(): number[];
  /** Closes every client socket. */
  dropClients(): void;
  /** A discovery record pointing at this hub. */
  discovery(root: string, pid?: number): EditorDiscovery;
  stop(): Promise<void>;
};

/** A session of the tests. */
export function session(id: string, extra: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    game: "tiny-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded: true,
    connectedAt: 1_790_000_000_000,
    ...extra
  };
}

/**
 * Starts a fake hub.
 *
 * @param options - The first session list and the published hot reload state.
 * @param options.sessions - The sessions sent on open.
 * @param options.hotReload - The `editor.hotReload` params sent on open, if any.
 */
export function startFakeHub(
  options: { sessions?: SessionInfo[]; hotReload?: Json } = {}
): FakeHub {
  const handlers = new Map<string, Handler>();
  const clients = new Set<ServerWebSocket<undefined>>();
  const requests: Received[] = [];
  const origins: string[] = [];
  const subs = new Set<number>();
  let sessions: SessionInfo[] = options.sessions ?? [];

  handlers.set("game.watch", params => {
    const sub = typeof params === "object" && params !== null && "sub" in params ? params.sub : -1;
    if (typeof sub === "number") subs.add(sub);
    return null;
  });
  handlers.set("game.unwatch", params => {
    const sub = typeof params === "object" && params !== null && "sub" in params ? params.sub : -1;
    if (typeof sub === "number") subs.delete(sub);
    return null;
  });

  const sessionsNote = (): string =>
    encode(notification("editor", "sessions", { list: sessions.map(entry => ({ ...entry })) }));

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname !== "/__editor/ws") return new Response("missing", { status: 404 });
      const origin = req.headers.get("origin") ?? "";
      origins.push(origin);
      if (origin !== `http://127.0.0.1:${srv.port}`)
        return new Response("forbidden", { status: 403 });
      if (url.searchParams.get("token") !== FAKE_TOKEN) {
        return new Response("unauthorized", { status: 401 });
      }
      if (url.searchParams.get("kind") !== "tools") return new Response("invalid", { status: 400 });
      return srv.upgrade(req) ? undefined : new Response("invalid", { status: 400 });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(sessionsNote());
        if (options.hotReload !== undefined) {
          ws.send(encode(notification("editor", "hotReload", options.hotReload)));
        }
      },
      async message(ws, text) {
        const message = decode(String(text));
        if (!("id" in message) || !("method" in message)) return;
        const { id, channel, method, params, session: asked } = message;
        requests.push({ channel, method, params, session: asked });
        const handler = handlers.get(`${channel}.${method}`);
        try {
          if (handler === undefined) throw new Error(`no handler for ${channel}.${method}`);
          ws.send(encode(success(id, await handler(params, asked))));
        } catch (error) {
          ws.send(encode(failure(id, toWireError(error))));
        }
      },
      close(ws) {
        clients.delete(ws);
      }
    }
  });
  const port = server.port ?? 0;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    origins,
    handle: (key, handler) => handlers.set(key, handler),
    setSessions: list => {
      sessions = list;
      for (const client of clients) client.send(sessionsNote());
    },
    notify: (channel, method, params, id) => {
      const text = encode(notification(channel, method, params, id));
      for (const client of clients) client.send(text);
    },
    value: (sub, value) => {
      const text = encode(notification("game", "value", { sub, value }));
      for (const client of clients) client.send(text);
    },
    watched: () => [...subs],
    dropClients: () => {
      for (const client of clients) client.close(1001, "editor stopping");
    },
    discovery: (root, pid = process.pid) => ({
      version: 1,
      pid,
      port,
      url: `http://127.0.0.1:${port}`,
      ws: `ws://127.0.0.1:${port}/__editor/ws`,
      token: FAKE_TOKEN,
      root,
      html: `${root}/web/index.html`,
      startedAt: 1_790_000_000_000
    }),
    stop: async () => {
      for (const client of clients) client.close(1001, "stop");
      // Bun's stop does not resolve while a close is in flight (as in cli.ts): bounded.
      await Promise.race([server.stop(true), Bun.sleep(100)]);
    }
  };
}

/**
 * Waits until a check passes (polls every 10 ms, at most 2 s).
 *
 * @param check - The check.
 * @param what - What is awaited, for the failure message.
 */
export async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}
