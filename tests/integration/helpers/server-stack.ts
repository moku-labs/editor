/**
 * @file The server stack of the root integration wave (plan §2.3): the server core from
 * `src/server.ts` on a real `Bun.serve`, a server probe that records `hub:session` and
 * `files:written`, and the wire tap on the hub's websocket handler.
 */
import type { ServerEvents } from "../../../src/config";
import type { Files, Hub } from "../../../src/server";
import { createApp, createPlugin } from "../../../src/server";
import { createPageDir } from "./project";
import { createTap, type Tap } from "./tap";

/** The server app type. */
export type ServerApp = ReturnType<typeof createApp>;

/** The pluginConfigs a server stack takes (shallow per plugin; `files.root` and `pages.pageDir` are set). */
export type ServerConfigs = NonNullable<
  NonNullable<Parameters<typeof createApp>[0]>["pluginConfigs"]
>;

/** The game's own serve options a test may change (B4, E2). */
export type ConsumerServe = {
  /** Game routes; `/` answers the small game page unless given. */
  readonly routes?: Readonly<Record<string, Response>>;
  /** The game's fetch fallback; a 404 "asset" unless given. Every call is recorded in `fetched`. */
  readonly fetch?: (req: Request) => Response | Promise<Response>;
};

/** One running editor server. */
export type ServerStack = {
  readonly kind: "server";
  readonly app: ServerApp;
  readonly server: Bun.Server<Hub.HubSocketData>;
  readonly port: number;
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** The hub token of this start. */
  readonly token: string;
  /** The project root files serves. */
  readonly root: string;
  /** The built-page folder pages serves. */
  readonly pageDir: string;
  readonly tap: Tap;
  /** Every `hub:session` payload, in order. */
  readonly sessions: ServerEvents["hub:session"][];
  /** Every `files:written` payload, in order. */
  readonly written: Files.FilesWritten[];
  /** The path of every request that reached the game's fetch fallback. */
  readonly fetched: string[];
  /** Stops the app, then the server (bounded: Bun's stop(true) may hang after a close). */
  stop(): Promise<void>;
};

/** How long `stop()` waits for Bun's `server.stop(true)`. */
const SERVER_STOP_MS = 300;

/** How long `startServerOnPort` retries a busy port. */
const PORT_RETRY_MS = 1000;

/**
 * The small game page of the consumer route `/`.
 *
 * @returns A fresh HTML response.
 */
function gamePage(): Response {
  return new Response(
    "<!doctype html><title>tiny game</title><body><div data-game-page></div></body>",
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

/**
 * The server probe: a real server plugin that records two global events.
 *
 * @param sessions - Where `hub:session` payloads go.
 * @param written - Where `files:written` payloads go.
 * @returns The plugin.
 */
function createServerProbe(sessions: ServerEvents["hub:session"][], written: Files.FilesWritten[]) {
  return createPlugin("serverProbe", {
    hooks: () => ({
      "hub:session": (payload: ServerEvents["hub:session"]) => {
        sessions.push(payload);
      },
      "files:written": (payload: Files.FilesWritten) => {
        written.push(payload);
      }
    })
  });
}

/**
 * Calls `Bun.serve`, retrying a busy port for up to `retryMs`.
 *
 * @param options - The serve options.
 * @param retryMs - 0 to try once.
 * @returns The server.
 * @throws {Error} The last error of Bun.serve when the port stays busy.
 */
async function serveWithRetry(
  options: Parameters<typeof Bun.serve<Hub.HubSocketData>>[0],
  retryMs: number
): Promise<Bun.Server<Hub.HubSocketData>> {
  const deadline = performance.now() + retryMs;
  for (;;) {
    try {
      return Bun.serve(options);
    } catch (error) {
      if (performance.now() > deadline) throw error;
      await Bun.sleep(20);
    }
  }
}

/**
 * Creates, starts and serves a server app on `port` (0 for a free one).
 *
 * @param root - The project root.
 * @param configs - Extra pluginConfigs, merged per plugin.
 * @param serve - The game's own routes and fetch.
 * @param port - The port.
 * @param retryMs - How long to retry a busy port.
 * @returns The running stack.
 * @throws {Error} When the port stays busy (the app is stopped first).
 */
async function launch(
  root: string,
  configs: ServerConfigs,
  serve: ConsumerServe,
  port: number,
  retryMs: number
): Promise<ServerStack> {
  const pageDir = await createPageDir();
  const sessions: ServerEvents["hub:session"][] = [];
  const written: Files.FilesWritten[] = [];
  const fetched: string[] = [];
  const app = createApp({
    plugins: [createServerProbe(sessions, written)],
    pluginConfigs: {
      ...configs,
      files: { root, ...configs.files },
      pages: { pageDir, ...configs.pages }
    }
  });
  app.log.clearSinks();
  await app.start();

  const tap = createTap();
  const fallback = serve.fetch ?? (() => new Response("asset", { status: 404 }));
  const options = app.hub.serve({
    port,
    routes: { "/": gamePage(), ...serve.routes },
    fetch: (req: Request) => {
      fetched.push(new URL(req.url).pathname);
      return fallback(req);
    }
  });
  const server = await serveWithRetry(
    { ...options, websocket: tap.wrap(app.hub.websocket) },
    retryMs
  ).catch(async (error: unknown) => {
    await app.stop().catch(() => undefined);
    throw error;
  });
  const bound = server.port ?? port;

  return {
    kind: "server",
    app,
    server,
    port: bound,
    origin: `http://127.0.0.1:${String(bound)}`,
    token: app.hub.token(),
    root,
    pageDir,
    tap,
    sessions,
    written,
    fetched,
    stop: async () => {
      await app.stop().catch(() => undefined);
      await Promise.race([server.stop(true), Bun.sleep(SERVER_STOP_MS)]);
    }
  };
}

/**
 * Starts the server core over `root` on a free port: `files.root = root`, `pages.pageDir` a fresh
 * built-page folder, the server probe, the wire tap, and the consumer route `/`.
 *
 * @param root - The project root.
 * @param configs - Extra pluginConfigs, merged per plugin (e.g. `{ hub: { callTimeoutMs: 300 } }`).
 * @param serve - The game's own routes and fetch.
 * @returns The running stack.
 */
export function startServer(
  root: string,
  configs: ServerConfigs = {},
  serve: ConsumerServe = {}
): Promise<ServerStack> {
  return launch(root, configs, serve, 0, 0);
}

/**
 * Starts the server core on a given port (E4, L4): retries `Bun.serve` on that port for up to
 * 1 s, then fails loudly.
 *
 * @param root - The project root.
 * @param port - The port to bind.
 * @param configs - Extra pluginConfigs, merged per plugin.
 * @param serve - The game's own routes and fetch.
 * @returns The running stack.
 */
export function startServerOnPort(
  root: string,
  port: number,
  configs: ServerConfigs = {},
  serve: ConsumerServe = {}
): Promise<ServerStack> {
  return launch(root, configs, serve, port, PORT_RETRY_MS);
}
