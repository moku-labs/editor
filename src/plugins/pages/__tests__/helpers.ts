import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { FilesApi } from "../../files/types";
import { guard } from "../../hub/security/guard";
import type { HubApi, HubServer } from "../../hub/types";
import { createPagesState } from "../state";
import type { PagesConfig, PagesState, RouteDeps } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the pages unit tests: a mock log, a fake hub (real guard),
// a fake files api, a fake Bun server and a temp page folder.
// ─────────────────────────────────────────────────────────────────────────────

/** The default config of the plugin (same values as index.ts). */
export const DEFAULT_CONFIG: PagesConfig = {
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  pageDir: undefined,
  gameUrl: "/"
};

/** The token the fake hub hands out. */
export const TOKEN = "k".repeat(43);

/** The R3 policy, verbatim. */
export const R3_CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src 'self'";

/** The page template of the fixture folder. */
export const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>moku editor</title>
    <link rel="stylesheet" crossorigin href="./assets/index-abc.css">
  </head>
  <body><div data-editor-root></div></body>
</html>
`;

/**
 * A full Log.LogApi made of mocks.
 *
 * @returns The mock log.
 */
export function createLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(() => []),
    expect: vi.fn(),
    addSink: vi.fn(),
    reset: vi.fn(),
    clearSinks: vi.fn()
  };
}

/** A fake hub: the real guard, a switchable token, a recording publish. */
export type FakeHub = HubApi & { started: boolean; readonly publish: Mock<HubApi["publish"]> };

/**
 * A fake hub api with the real guard and a token that throws when not started.
 *
 * @returns The fake hub.
 */
export function createHub(): FakeHub {
  const hub: FakeHub = {
    started: true,
    serve: vi.fn(),
    token: () => {
      if (!hub.started) throw new Error("[moku-editor] hub.token() needs a started app.");
      return TOKEN;
    },
    sessions: () => [],
    fetch: () => undefined,
    websocket: {
      open: vi.fn(),
      message: vi.fn(),
      close: vi.fn(),
      drain: vi.fn(),
      maxPayloadLength: 1,
      idleTimeout: 1,
      perMessageDeflate: false
    },
    addRoutes: vi.fn(),
    guard: (req, server, mode) => guard(req, server, mode, new Set()),
    publish: vi.fn<HubApi["publish"]>(),
    closeAll: vi.fn<HubApi["closeAll"]>(),
    path: () => "/__editor"
  };
  return hub;
}

/**
 * A fake files api: only root() matters to pages.
 *
 * @param root - The real project root it reports.
 * @returns The fake files api.
 */
export function createFiles(root = "/projects/merge-game"): FilesApi {
  return {
    list: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    writeBinary: vi.fn(),
    readBinary: vi.fn(),
    resolve: vi.fn(),
    root: () => root
  };
}

/** The fake Bun server on port 4000. */
export const SERVER: HubServer = { port: 4000, upgrade: () => false };

/**
 * A request to the fake server with the loopback Host.
 *
 * @param path - Path and query.
 * @param init - Method, extra headers and body.
 * @param init.method - HTTP method (default GET).
 * @param init.headers - Extra headers.
 * @param init.body - Request body (POST).
 * @returns The request.
 */
export function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Request {
  return new Request(`http://127.0.0.1:4000${path}`, {
    method: init.method ?? "GET",
    headers: { host: "127.0.0.1:4000", ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body })
  });
}

/** Route deps plus the parts a test inspects. */
export type Harness = {
  readonly deps: RouteDeps;
  readonly hub: FakeHub;
  readonly log: ReturnType<typeof createLog>;
  readonly state: PagesState;
};

/**
 * Route deps over a page folder.
 *
 * @param pageDir - The resolved page folder, or undefined.
 * @param config - Config overrides.
 * @returns The harness.
 */
export function createHarness(
  pageDir: string | undefined,
  config: Partial<PagesConfig> = {}
): Harness {
  const full: PagesConfig = { ...DEFAULT_CONFIG, ...config };
  const state = createPagesState({ config: full });
  state.pageDir = pageDir;
  const hub = createHub();
  const log = createLog();
  return { deps: { hub, files: createFiles(), config: full, state, log }, hub, log, state };
}

/**
 * A temp page folder: index.html (TEMPLATE unless given) and a few assets.
 *
 * @param template - The index.html text.
 * @returns The folder path.
 */
export async function createPageDir(template = TEMPLATE): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "moku-pages-"));
  await mkdir(join(dir, "assets", "nested"), { recursive: true });
  await writeFile(join(dir, "index.html"), template);
  await writeFile(join(dir, "assets", "app-abc.js"), "console.log(1);");
  await writeFile(join(dir, "assets", "index-abc.css"), "body{margin:0}");
  await writeFile(
    join(dir, "assets", "Geist-1a2b.woff2"),
    new Uint8Array([0x77, 0x4f, 0x46, 0x32])
  );
  await writeFile(join(dir, "assets", "nested", "a.js"), "1");
  await writeFile(join(dir, "assets", ".hidden"), "secret");
  return dir;
}

/**
 * The JSON text of the boot tag in a served page.
 *
 * @param html - The page.
 * @returns The JSON text, or undefined.
 */
export function bootJsonOf(html: string): string | undefined {
  return /<script type="application\/json" id="moku-editor-boot">([\s\S]*?)<\/script>/.exec(
    html
  )?.[1];
}

/**
 * A raw HTTP/1.1 GET with any Host header (fetch may not let a test forge Host). Resolves with
 * the status code and the raw response text.
 *
 * @param port - Server port.
 * @param path - Request path.
 * @param host - The Host header.
 * @returns Status and text (0 when the server closed without a status line).
 */
export function rawGet(
  port: number,
  path: string,
  host: string
): Promise<{ status: number; text: string }> {
  return new Promise(resolve => {
    let received = "";
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    const done = (): void => {
      socket.destroy();
      const match = /^HTTP\/1\.[01] (\d{3})/.exec(received);
      resolve({ status: match === null ? 0 : Number(match[1]), text: received });
    };
    socket.on("data", chunk => {
      received += chunk.toString();
    });
    socket.on("end", done);
    socket.on("close", done);
    socket.on("error", done);
  });
}
