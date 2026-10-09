import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createMokuGame,
  MOKU_GAME_MARKER,
  MOKU_GAME_TITLE
} from "../../../../../tests/fixtures/moku-game";
import { bootJsonOf, rawGet } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The moku-editor bin as a real process: a tiny game folder and an engine game
// page (a game on the npm @moku-labs/game that Bun bundles), served next to the
// editor on a random port; and a moku-game folder with no html at all, whose
// page the engine writes (B5).
// ─────────────────────────────────────────────────────────────────────────────

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const BIN = join(REPO, "src", "plugins", "pages", "bin.ts");

/** A spawned bin and the stdout read so far. */
type Running = {
  readonly child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  readonly port: number;
  output: () => string;
};

/** The stdout line of a serving bin. */
const TOOLS_LINE = /Tools\s+http/;

/** How long a test waits for a signalled bin to exit: with the 20 s deadline of `spawnBin` it stays under the 30 s test timeout. */
const EXIT_WAIT_MS = 5000;

/** How long `spawnBin` waits for the line of a starting bin. */
const READY_WAIT_MS = 20_000;

/**
 * How long a test waits for a serving bin to exit after its signal. The bin's own stop is bounded
 * (about a second), so a bin that still runs after this is stuck; the wait ends under the 60 s
 * test timeout, and the test fails with its own message.
 */
const STOP_WAIT_MS = 30_000;

/** What a test says instead of an exit code when a signalled bin does not exit. */
const STILL_RUNS = "the bin still runs";

/** What the cleanup needs of a spawned bin. */
type Spawned = Pick<Running["child"], "exited" | "kill">;

/** Every bin a test spawned that has not exited: `afterEach` ends the ones a test left behind. */
const spawned = new Set<Spawned>();

/**
 * Remembers a spawned bin until it exits.
 *
 * @param child - The bin.
 */
async function track(child: Spawned): Promise<void> {
  spawned.add(child);
  await child.exited;
  spawned.delete(child);
}

/**
 * Waits for a promise, at most `ms`; the timer does not outlive the wait.
 *
 * @param promise - What is waited for.
 * @param ms - The longest wait.
 * @returns The value, or undefined after `ms`.
 */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>(resolve => {
    timer = setTimeout(resolve, ms, undefined);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The exit code of a signalled bin.
 *
 * @param bin - The bin.
 * @param ms - The longest wait for its exit.
 * @returns Its exit code, or `STILL_RUNS` when it has not exited after `ms`.
 */
async function exitOf(bin: Running, ms = STOP_WAIT_MS): Promise<number | string> {
  return (await within(bin.child.exited, ms)) ?? STILL_RUNS;
}

/**
 * Spawns the bin and waits for a line of its stdout: the Tools line of a serving bin by default.
 * The wait ends with the line, with the end of the bin's stdout, or after `READY_WAIT_MS`: by the
 * clock, not by the next read, which a bin that prints nothing and does not exit never answers.
 *
 * @param args - Bin arguments.
 * @param detached - Start it as the leader of its own process group, as a shell does.
 * @param ready - The stdout text to wait for.
 * @returns The running bin with its real port (0 before it serves).
 */
async function spawnBin(args: string[], detached = false, ready = TOOLS_LINE): Promise<Running> {
  const child = Bun.spawn(["bun", BIN, ...args], {
    cwd: REPO,
    detached,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });
  void track(child);
  let text = "";
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  const seen = Promise.withResolvers<void>();
  const pump = async (): Promise<void> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
      if (ready.test(text)) seen.resolve();
    }
    seen.resolve();
  };
  void pump();
  await within(seen.promise, READY_WAIT_MS);
  const port = Number(/Game\s+http:\/\/127\.0\.0\.1:(\d+)\//.exec(text)?.[1] ?? 0);
  return { child, port, output: () => text };
}

/**
 * Runs the bin to completion.
 *
 * @param args - Bin arguments.
 * @returns Exit code and all output.
 */
async function runBin(args: string[]): Promise<{ code: number; output: string }> {
  const child = Bun.spawn(["bun", BIN, ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  void track(child);
  const [out, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  return { code: await child.exited, output: out + error };
}

/**
 * Fetches a URL until it answers 200: a fresh bin may answer 503 while Bun bundles the page.
 *
 * @param url - The URL.
 * @returns The first 200 response, or the last one after 20 s.
 */
async function firstOk(url: string): Promise<Response> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const response = await fetch(url);
    if (response.status === 200 || Date.now() > deadline) return response;
    await response.body?.cancel();
    await Bun.sleep(100);
  }
}

/**
 * Whether a process is still running.
 *
 * @param pid - The process id.
 * @returns True while it runs.
 */
function isAlive(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

/** The script path Bun's HMR client is served from: in the game HTML only while hot reload is on. */
const HMR_CLIENT = "/_bun/client";

/**
 * POSTs a hot reload change to a running bin.
 *
 * @param origin - The bin's origin.
 * @param token - The boot token.
 * @param hmr - The asked value.
 * @returns The response.
 */
function postHmr(origin: string, token: string, hmr: boolean): Promise<Response> {
  return fetch(`${origin}/__editor/hmr`, {
    method: "POST",
    headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ hmr })
  });
}

/** The path of Bun's HMR socket: only its dev server, the one with hot reload on, upgrades it. */
const HMR_SOCKET = "/_bun/hmr";

/** How long one request or one socket open of a wait loop may take before it is tried again. */
const TRY_MS = 5000;

/**
 * Reads the game page until it carries Bun's HMR client or not, as asked; requests that fail
 * while the server restarts, or get no answer in `TRY_MS`, are tried again.
 *
 * @param origin - The bin's origin.
 * @param hmr - Whether the page should carry the HMR client.
 * @returns The last page text.
 */
async function gamePageWith(origin: string, hmr: boolean): Promise<string> {
  const deadline = Date.now() + 15_000;
  let html = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(TRY_MS) });
      html = await response.text();
      if (html.includes(HMR_CLIENT) === hmr) return html;
    } catch {
      // The server is between its stop and its next serve, or did not answer in time.
    }
    await Bun.sleep(50);
  }
  return html;
}

/**
 * Tries once to open Bun's HMR socket on a bin, and closes it again.
 *
 * @param origin - The bin's origin.
 * @returns True when the socket opened; false when it was refused or did not open in `TRY_MS`.
 */
async function opensHmrSocket(origin: string): Promise<boolean> {
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}${HMR_SOCKET}`);
  const opened = new Promise<boolean>(resolve => {
    socket.addEventListener("open", () => {
      resolve(true);
    });
    socket.addEventListener("error", () => {
      resolve(false);
    });
    socket.addEventListener("close", () => {
      resolve(false);
    });
  });
  const result = await within(opened, TRY_MS);
  socket.close();
  return result === true;
}

/**
 * Waits until Bun's dev server answers on a bin: its HMR socket opens. The server without HMR
 * refuses the socket, and so does a server between its stop and its next serve.
 *
 * @param origin - The bin's origin.
 * @returns True once the dev server is up, false after 15 s.
 */
async function devServerUp(origin: string): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await opensHmrSocket(origin)) return true;
    await Bun.sleep(50);
  }
  return false;
}

/** How a client socket closed. */
type Closed = { readonly code: number; readonly reason: string };

/**
 * Opens an editor socket of a kind on a running bin (with the Origin header, as outside a browser)
 * and waits until it is open.
 *
 * @param origin - The bin's origin.
 * @param token - The boot token.
 * @param kind - Agent or tools.
 * @returns Resolves once open, with the promise of its close (wrapped: an async function would
 * adopt a returned promise and wait for the close).
 */
async function openClient(
  origin: string,
  token: string,
  kind: "agent" | "tools"
): Promise<{ readonly closed: Promise<Closed> }> {
  const url = `${origin.replace("http:", "ws:")}/__editor/ws?token=${token}&kind=${kind}`;
  const socket: WebSocket = Reflect.construct(WebSocket, [url, { headers: { origin } }]);
  const closed = new Promise<Closed>(resolve => {
    socket.addEventListener("close", event => {
      resolve({ code: event.code, reason: event.reason });
    });
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve();
    });
    socket.addEventListener("error", () => {
      reject(new Error(`the ${kind} socket did not open`));
    });
  });
  return { closed };
}

/** A bunfig plugin that rewrites the marker of the game's main.ts: the page shows it ran. */
const MARKER_PLUGIN = String.raw`export default {
  name: "marker",
  setup(build) {
    build.onLoad({ filter: /\/main\.ts$/ }, async ({ path }) => ({
      contents: (await Bun.file(path).text()).replace("MARKER_ORIGINAL", "MARKER_INJECTED"),
      loader: "ts"
    }));
  }
};
`;

/**
 * The text of every script of a served page.
 *
 * @param origin - The bin's origin.
 * @returns The joined JavaScript.
 */
async function pageScripts(origin: string): Promise<string> {
  const html = await fetch(`${origin}/`).then(response => response.text());
  let js = "";
  for (const match of html.matchAll(/src="([^"]+\.js)"/g)) {
    js += await fetch(new URL(match[1] ?? "", `${origin}/`)).then(response => response.text());
  }
  return js;
}

/**
 * The entry of the engine game page: a headless-safe game on the npm `@moku-labs/game` that names
 * itself in the title once its app is made, so the bundle carries the engine.
 */
const ENGINE_MAIN = `import { createApp, defineGame, type } from "@moku-labs/game";

const { defineNode, defineFlow } = defineGame();
const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });
const mainFlow = defineFlow("main", { nodes: { home }, start: "home", edges: { home: { play: "home" } } });
const app = createApp({
  pluginConfigs: {
    model: { initialPlayer: { coins: 0 }, initialSession: {}, seed: 1 },
    flow: { mainFlow, safeNode: "home" }
  }
});
document.title = "ENGINE_GAME " + typeof app.flow.run;
`;

/** The line the stub engine prints when its first keys scan starts. */
const SCAN_OPEN = "STUB_FIRST_SCAN_OPEN";

/**
 * A stand-in for `@moku-labs/game/cli` in the game's own node_modules: the page is "written" at
 * once, and the first keys scan stays open for a minute, so a signal lands before any child.
 */
const HELD_SCAN_CLI = `import path from "node:path";

export async function preparePage(root) {
  const folder = path.join(root, ".moku");
  return { html: path.join(folder, "index.html"), bunfig: path.join(folder, "bunfig.toml") };
}

export function watchKeys() {
  console.log("${SCAN_OPEN}");
  return new Promise(resolve => setTimeout(() => resolve({ close() {} }), 60_000));
}
`;

/**
 * Writes a moku-game folder whose engine cli is `HELD_SCAN_CLI`.
 *
 * @returns The real path of the game folder.
 */
async function createHeldScanGame(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "moku-bin-held-")));
  const engine = join(root, "node_modules", "@moku-labs", "game");
  await mkdir(engine, { recursive: true });
  await writeFile(join(root, "index.ts"), "export default {};\n");
  await writeFile(join(root, "config.ts"), "export default {};\n");
  await writeFile(
    join(engine, "package.json"),
    '{"name":"@moku-labs/game","version":"0.13.1","type":"module","exports":{"./cli":"./cli.mjs"}}'
  );
  await writeFile(join(engine, "cli.mjs"), HELD_SCAN_CLI);
  return root;
}

let game: string;
let bunfigGame: string;
let engineGame: string;
let mokuGame: string;
let heldScanGame: string;

beforeAll(async () => {
  // dist/ (the agent page and the tools page) is built once by tests/global-build.ts.
  game = await realpath(await mkdtemp(join(tmpdir(), "moku-bin-")));
  await writeFile(
    join(game, "index.html"),
    '<!doctype html><html><head><title>tiny game</title></head><body><div id="tiny"></div><script type="module" src="./main.ts"></script></body></html>'
  );
  await writeFile(join(game, "main.ts"), 'document.title = "tiny game";\n');
  await writeFile(join(game, "data.json"), '{"level":1}');
  await writeFile(join(game, ".env"), "SECRET=1");
  bunfigGame = await realpath(await mkdtemp(join(tmpdir(), "moku-bin-bunfig-")));
  await writeFile(
    join(bunfigGame, "index.html"),
    '<!doctype html><html><head><title>bunfig game</title></head><body><script type="module" src="./main.ts"></script></body></html>'
  );
  await writeFile(
    join(bunfigGame, "main.ts"),
    'export const marker = "MARKER_ORIGINAL";\nconsole.log(marker);\n'
  );
  await writeFile(join(bunfigGame, "marker-plugin.ts"), MARKER_PLUGIN);
  await writeFile(
    join(bunfigGame, "bunfig.toml"),
    '[serve.static]\nplugins = ["./marker-plugin.ts"]\n'
  );
  // A game project the way a real one sits: web/index.html, its manifest at the root, and the
  // engine resolved from node_modules (this repository's, linked in).
  engineGame = await realpath(await mkdtemp(join(tmpdir(), "moku-bin-engine-")));
  await mkdir(join(engineGame, "web"));
  await writeFile(
    join(engineGame, "web", "index.html"),
    '<!doctype html><html><head><title>engine game</title></head><body><div id="game"></div><script type="module" src="./main.ts"></script></body></html>'
  );
  await writeFile(join(engineGame, "web", "main.ts"), ENGINE_MAIN);
  await writeFile(join(engineGame, "manifest.json"), '{"version":1,"bundles":{}}');
  await symlink(join(REPO, "node_modules"), join(engineGame, "node_modules"), "dir");
  mokuGame = await createMokuGame();
  heldScanGame = await createHeldScanGame();
}, 120_000);

afterEach(async () => {
  // A test that failed or timed out before its bin exited leaves it running, or stopping. No bin
  // outlives its test: SIGKILL, because a stuck bin answers no other signal.
  const left = [...spawned];
  for (const child of left) child.kill("SIGKILL");
  await Promise.all(left.map(child => child.exited));
});

afterAll(async () => {
  await rm(game, { recursive: true, force: true });
  await rm(bunfigGame, { recursive: true, force: true });
  await rm(engineGame, { recursive: true, force: true });
  await rm(mokuGame, { recursive: true, force: true });
  await rm(heldScanGame, { recursive: true, force: true });
});

describe("moku-editor bin", () => {
  it("serves the game, its files and the editor; stops on SIGINT with 0", async () => {
    const bin = await spawnBin([join(game, "index.html"), "--port", "0", "--root", game]);
    try {
      expect(bin.port).toBeGreaterThan(0);
      const origin = `http://127.0.0.1:${bin.port}`;
      const page = await fetch(`${origin}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('id="tiny"');
      const data = await fetch(`${origin}/data.json`);
      expect(data.status).toBe(200);
      expect(await data.json()).toEqual({ level: 1 });
      await expect(fetch(`${origin}/.env`)).resolves.toHaveProperty("status", 404);
      await expect(rawGet(bin.port, "/data.json", `evil.com:${bin.port}`)).resolves.toHaveProperty(
        "status",
        403
      );
      const tools = await fetch(`${origin}/__editor/`);
      expect(tools.status).toBe(200);
      const boot = JSON.parse(bootJsonOf(await tools.text()) ?? "{}");
      expect(boot.root).toBe(game);
      const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      expect(hello.status).toBe(200);
      const { token } = await hello.json();
      expect(token).toBe(boot.token);
      expect(bin.output()).toContain(`Tools  ${origin}/__editor/`);
      expect(bin.output()).not.toContain(token);
      const discovery = JSON.parse(await readFile(join(game, ".moku", "editor.json"), "utf8"));
      expect(discovery).toMatchObject({ version: 1, port: bin.port, token, root: game });
      expect(discovery.pid).toBe(bin.child.pid);

      const second = await runBin([join(game, "index.html"), "--port", String(bin.port)]);
      expect(second.code).toBe(1);
      expect(second.output).toContain("is in use");
      expect(second.output).toContain(`--port ${bin.port + 1}`);
    } finally {
      bin.child.kill("SIGINT");
    }
    expect(await exitOf(bin)).toBe(0);
    expect(bin.output()).toContain("stopped");
    expect(existsSync(join(game, ".moku", "editor.json"))).toBe(false);
  }, 60_000);

  it("switches hot reload on the same port: each POST answers the asked hmr, / gains and loses Bun's HMR client, open clients see 1012 (D-32, A14, U11)", async () => {
    const bin = await spawnBin([join(game, "index.html"), "--port", "0", "--root", game]);
    try {
      const origin = `http://127.0.0.1:${bin.port}`;
      const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      const { token } = await hello.json();
      expect(await gamePageWith(origin, true)).toContain(HMR_CLIENT);
      const agent = await openClient(origin, token, "agent");
      const tools = await openClient(origin, token, "tools");

      for (const hmr of [false, true]) {
        const answer = await postHmr(origin, token, hmr);
        expect(answer.status).toBe(200);
        expect(await answer.json()).toEqual({ hmr, owner: "bin" });
        // The page is asked for once the dev server is up, as the editor does: it reloads the
        // game frame after the game is back. A page request that still reaches the server
        // without HMR starts a rebundle there (Bun rebundles that page on every request), and
        // Bun 1.3.14 can freeze when that bundle and the dev server's first one run at once.
        if (hmr) expect(await devServerUp(origin)).toBe(true);
        const html = await gamePageWith(origin, hmr);
        expect(html).toContain('id="tiny"');
        expect(html.includes(HMR_CLIENT)).toBe(hmr);
      }

      // The restart closed every client cleanly before Bun's stop (U11).
      const restarting = { code: 1012, reason: "editor restarting" };
      await expect(agent.closed).resolves.toEqual(restarting);
      await expect(tools.closed).resolves.toEqual(restarting);

      const again = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      const helloAgain: { token: string } = await again.json();
      expect(helloAgain.token).toBe(token);
      const discovery = JSON.parse(await readFile(join(game, ".moku", "editor.json"), "utf8"));
      expect(discovery).toMatchObject({ port: bin.port, token });
    } finally {
      bin.child.kill("SIGINT");
    }
    expect(await exitOf(bin)).toBe(0);
  }, 60_000);

  it("writes .moku/editor.json 0600 and removes it on SIGTERM (M3)", async () => {
    const bin = await spawnBin([join(game, "index.html"), "--port", "0", "--root", game]);
    const path = join(game, ".moku", "editor.json");
    try {
      const file = await stat(path);
      expect(file.mode & 0o777).toBe(0o600);
    } finally {
      bin.child.kill("SIGTERM");
    }
    expect(await exitOf(bin)).toBe(0);
    expect(existsSync(path)).toBe(false);
  }, 60_000);

  it("honours the bunfig.toml of a root started from elsewhere: a re-spawned child serves the plugin's build, writes its own pid and stops once on a group Ctrl+C (B2)", async () => {
    const html = join(bunfigGame, "index.html");
    const bin = await spawnBin([html, "--port", "0", "--root", bunfigGame], true);
    const path = join(bunfigGame, ".moku", "editor.json");
    try {
      expect(bin.port).toBeGreaterThan(0);
      const origin = `http://127.0.0.1:${bin.port}`;
      const js = await pageScripts(origin);
      expect(js).toContain("MARKER_INJECTED");
      expect(js).not.toContain("MARKER_ORIGINAL");
      const discovery = JSON.parse(await readFile(path, "utf8"));
      expect(discovery).toMatchObject({ port: bin.port, root: bunfigGame, html });
      expect(discovery.pid).not.toBe(bin.child.pid);
      expect(process.kill(discovery.pid, 0)).toBe(true);
    } finally {
      // A terminal Ctrl+C: SIGINT to the whole process group of the bin.
      process.kill(-bin.child.pid, "SIGINT");
    }
    expect(await exitOf(bin)).toBe(0);
    expect(bin.output().match(/stopped/g)).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
  }, 60_000);

  it("a re-spawned child stops by itself when its parent dies by SIGKILL, which forwards no signal (A4)", async () => {
    const html = join(bunfigGame, "index.html");
    const bin = await spawnBin([html, "--port", "0", "--root", bunfigGame], true);
    const path = join(bunfigGame, ".moku", "editor.json");
    const { pid } = JSON.parse(await readFile(path, "utf8")) as { pid: number };
    try {
      expect(pid).not.toBe(bin.child.pid);
      bin.child.kill("SIGKILL");
      await bin.child.exited;

      // The child sees its parent pid change within a second, stops and exits.
      const deadline = Date.now() + 10_000;
      while (isAlive(pid) && Date.now() < deadline) await Bun.sleep(100);
      expect(isAlive(pid)).toBe(false);
      expect(existsSync(path)).toBe(false);
    } finally {
      if (isAlive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  it("prints the Claude Code setup for mcp-config with 0 (M8)", async () => {
    const result = await runBin(["mcp-config", "web/index.html", "--port", "3000"]);
    expect(result.code).toBe(0);
    expect(result.output).toContain('"command": "bunx"');
    expect(result.output).toContain(
      "claude mcp add moku-editor -- bunx moku-editor mcp web/index.html --port 3000"
    );
  }, 30_000);

  it("serves an engine game page bundled from @moku-labs/game, and its manifest", async () => {
    const bin = await spawnBin([
      join(engineGame, "web", "index.html"),
      "--port",
      "0",
      "--root",
      engineGame
    ]);
    try {
      const origin = `http://127.0.0.1:${bin.port}`;
      const page = await firstOk(`${origin}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('id="game"');
      const js = await pageScripts(origin);
      expect(js).toContain("ENGINE_GAME");
      expect(js).toContain("[game]");
      await expect(fetch(`${origin}/manifest.json`)).resolves.toHaveProperty("status", 200);
      await expect(fetch(`${origin}/__editor/`)).resolves.toHaveProperty("status", 200);
      const hello = await fetch(`${origin}/__editor/hello`, { headers: { origin } });
      expect(hello.status).toBe(200);
    } finally {
      bin.child.kill("SIGINT");
    }
    expect(await exitOf(bin)).toBe(0);
  }, 60_000);

  it("serves a moku-game folder with no html: the engine writes .moku/, a bin re-run under its bunfig serves the page with the editor's agent, and stops on SIGINT with 0 (B5, D-51)", async () => {
    const html = join(mokuGame, ".moku", "index.html");
    const path = join(mokuGame, ".moku", "editor.json");
    const bin = await spawnBin(["--root", mokuGame, "--port", "0"]);
    try {
      expect(bin.port).toBeGreaterThan(0);
      expect(existsSync(html)).toBe(true);
      expect(existsSync(join(mokuGame, ".moku", "bunfig.toml"))).toBe(true);
      const origin = `http://127.0.0.1:${bin.port}`;
      const page = await firstOk(`${origin}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain(`<title>${MOKU_GAME_TITLE}</title>`);
      const js = await pageScripts(origin);
      expect(js).toContain(MOKU_GAME_MARKER);
      // The editor's page agent, bundled from this tree's dist through scripts/tree/bundle.ts.
      expect(js).toContain("/__editor/hello");
      await expect(fetch(`${origin}/.moku/index.html`)).resolves.toHaveProperty("status", 404);
      await expect(fetch(`${origin}/__editor/`)).resolves.toHaveProperty("status", 200);
      const discovery = JSON.parse(await readFile(path, "utf8"));
      expect(discovery).toMatchObject({ port: bin.port, root: mokuGame, html });
      expect(discovery.pid).not.toBe(bin.child.pid);
    } finally {
      bin.child.kill("SIGINT");
    }
    expect(await exitOf(bin)).toBe(0);
    expect(bin.output().match(/stopped/g)).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
  }, 60_000);

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143]
  ] as const)(
    "a %s during the engine's first keys scan ends the bin at once with %i: no child is spawned and nothing serves (B5)",
    async (signal, code) => {
      const path = join(heldScanGame, ".moku", "editor.json");
      const bin = await spawnBin(
        ["--root", heldScanGame, "--port", "0"],
        false,
        /STUB_FIRST_SCAN_OPEN/
      );
      try {
        // The page is written and the first scan is open: the child comes only after it.
        expect(bin.output()).toContain(SCAN_OPEN);
        bin.child.kill(signal);
        expect(await exitOf(bin, EXIT_WAIT_MS)).toBe(code);
      } finally {
        bin.child.kill("SIGKILL");
      }
      // The exit is awaited above; one tick lets the output pump take the last bytes.
      await bin.child.exited;
      await Bun.sleep(0);
      expect(bin.output()).not.toMatch(TOOLS_LINE);
      expect(existsSync(path)).toBe(false);
    },
    30_000
  );

  it("exits 2 without an html file for a root that is not a moku-game folder (B5)", async () => {
    const result = await runBin(["--root", game, "--port", "0"]);
    expect(result.code).toBe(2);
    expect(result.output).toContain("has no index.ts and config.ts");
  }, 30_000);

  it("prints usage on --help (0) and refuses bad arguments with 2 (P14)", async () => {
    const help = await runBin(["--help"]);
    expect(help.code).toBe(0);
    expect(help.output).toContain("moku-editor <game-html>");
    expect(help.output).toContain("moku-editor mcp-config");
    const hostile = await runBin(["x.html", "--host", "0.0.0.0"]);
    expect(hostile.code).toBe(2);
  }, 30_000);

  it("exits 1 for a missing HTML file", async () => {
    const missing = await runBin([join(game, "nope.html"), "--port", "0"]);
    expect(missing.code).toBe(1);
    expect(missing.output).toContain("[moku-editor]");
  }, 30_000);
});
