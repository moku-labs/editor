import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bridgePlugin, capturePlugin, createApp } from "../../src/agent";
import {
  createProject,
  createTinyGame,
  FIRST_NOTE,
  installPage,
  PNG_1X1,
  shutdown,
  TINY_NAME,
  type TinyGame,
  tinyModule,
  until,
  withRenderer
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// The MCP bridge end to end (change 2026-10-05-mcp, U5): the real moku-editor
// bin as a process, an agent on the tiny game linked to its hub over the real
// wire, and `moku-editor mcp` as a second process driven over stdin/stdout the
// way Claude Code drives it. Stdin end (or SIGTERM) stops the bridge with 0;
// it stops the bin only when it started it.
// ─────────────────────────────────────────────────────────────────────────────

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const BIN = path.join(REPO, "src", "plugins", "pages", "bin.ts");

/** How long a process start or a bridge answer may take. */
const SLOW_MS = 30_000;

/** The hub path of the bin. */
const HUB_PATH = "/__editor";

/** The `.moku/editor.json` the bin writes (the fields the test reads). */
type Discovery = { readonly pid: number; readonly port: number; readonly url: string };

/** One frame the bridge wrote to stdout. */
type Frame = {
  readonly jsonrpc?: string;
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
};

/** A tools/call result. */
type ToolAnswer = {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly isError?: boolean;
};

/** A bridge process and the frames it wrote. */
type Bridge = {
  readonly child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
  /** Every stdout line, raw. */
  readonly lines: string[];
  readonly stderr: () => string;
  request(method: string, params?: object): Promise<Frame>;
  notify(method: string): void;
  call(name: string, args?: object): Promise<ToolAnswer>;
  /** Ends stdin and resolves with the exit code. */
  close(): Promise<number>;
};

/** A bin started by the test. */
type RunningBin = {
  readonly child: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
  readonly discovery: Discovery;
  readonly output: () => string;
};

const children: {
  kill(signal?: number | NodeJS.Signals): void;
  readonly exited: Promise<number>;
}[] = [];
const apps: { stop(): Promise<void> }[] = [];

/**
 * Collects a byte stream as text in the background.
 *
 * @param stream - The stream.
 * @returns A reader of the text so far.
 */
function collect(stream: ReadableStream<Uint8Array>): () => string {
  let text = "";
  const decoder = new TextDecoder();
  void (async () => {
    for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  })();
  return () => text;
}

/**
 * Writes the game page the bin serves: an HTML file and its module.
 *
 * @param root - The project root.
 * @returns The absolute HTML path.
 */
async function writeGamePage(root: string): Promise<string> {
  const html = path.join(root, "index.html");
  await writeFile(
    html,
    '<!doctype html><html><head><title>tiny game</title></head><body><div data-game-page></div><script type="module" src="./main.ts"></script></body></html>'
  );
  await writeFile(path.join(root, "main.ts"), 'document.title = "tiny game";\n');
  return html;
}

/**
 * Reads `.moku/editor.json`, or undefined while there is none.
 *
 * @param root - The project root.
 * @returns The discovery record.
 */
async function readDiscovery(root: string): Promise<Discovery | undefined> {
  try {
    return JSON.parse(await readFile(path.join(root, ".moku", "editor.json"), "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * True while a pid runs.
 *
 * @param pid - The pid.
 * @returns Whether it runs.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A free loopback port.
 *
 * @returns The port.
 */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

/**
 * Starts the bin on a free port and waits for its discovery file.
 *
 * @param root - The project root.
 * @param html - The game HTML file.
 * @returns The running bin.
 */
async function startBin(root: string, html: string): Promise<RunningBin> {
  const child = Bun.spawn(["bun", BIN, html, "--port", "0", "--root", root], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });
  children.push(child);
  const out = collect(child.stdout);
  const error = collect(child.stderr);
  let discovery: Discovery | undefined;
  await until(
    async () => {
      discovery = await readDiscovery(root);
      return discovery?.pid === child.pid;
    },
    "the discovery file of the bin",
    SLOW_MS
  );
  if (discovery === undefined) throw new Error("no discovery file");
  return { child, discovery, output: () => out() + error() };
}

/**
 * Starts `moku-editor mcp` with pipes and wraps its stdio as a JSON-RPC client.
 *
 * @param args - The arguments after `mcp`.
 * @param cwd - The working directory (the project root).
 * @returns The bridge.
 */
function startBridge(args: readonly string[], cwd: string): Bridge {
  const child = Bun.spawn(["bun", BIN, "mcp", ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });
  children.push(child);
  const stderr = collect(child.stderr);
  const lines: string[] = [];
  const frames: Frame[] = [];
  const decoder = new TextDecoder();
  void (async () => {
    let buffered = "";
    for await (const chunk of child.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      let end = buffered.indexOf("\n");
      while (end !== -1) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        lines.push(line);
        frames.push(JSON.parse(line));
        end = buffered.indexOf("\n");
      }
    }
  })();

  let nextId = 1;
  /**
   * Writes one message line to stdin.
   *
   * @param message - The message.
   */
  const send = (message: object): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.flush();
  };
  /**
   * Sends a request and waits for its response.
   *
   * @param method - The method.
   * @param params - The params.
   * @returns The response frame.
   */
  const request = async (method: string, params?: object): Promise<Frame> => {
    const id = nextId;
    nextId += 1;
    send(
      params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params }
    );
    await until(() => frames.some(frame => frame.id === id), `the answer to ${method}`, SLOW_MS);
    const answer = frames.find(frame => frame.id === id);
    if (answer === undefined) throw new Error(`no answer to ${method}`);
    return answer;
  };

  return {
    child,
    lines,
    stderr,
    request,
    notify: method => send({ jsonrpc: "2.0", method }),
    call: async (name, args = {}) => {
      const frame = await request("tools/call", { name, arguments: args });
      return frame.result as ToolAnswer;
    },
    close: async () => {
      await child.stdin.end();
      return child.exited;
    }
  };
}

/**
 * The first text of a tool answer.
 *
 * @param answer - The answer.
 * @returns The text, or "".
 */
function textOf(answer: ToolAnswer): string {
  return answer.content[0]?.text ?? "";
}

/**
 * Starts an agent with bridge and capture on the tiny game, linked to a bin's hub.
 *
 * @param origin - The bin's origin.
 * @param png - The data URL a stub renderer answers; none leaves the headless game without one.
 * @returns The started game.
 */
async function startTinyAgent(origin: string, png?: string): Promise<TinyGame> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  installPage(origin, HUB_PATH);
  const game = await createTinyGame();
  apps.push(game);
  const served = png === undefined ? game.app : withRenderer(game.app, png);
  const agent = createApp({
    plugins: [bridgePlugin, capturePlugin],
    pluginConfigs: {
      registry: { game: served, modules: [tinyModule], name: TINY_NAME },
      channel: { heartbeatMs: 100 },
      bridge: { hello: `${origin}${HUB_PATH}/hello`, retryMs: 100 },
      overlay: { mount: "[data-game-page]" }
    }
  });
  agent.log.clearSinks();
  await agent.start();
  apps.unshift(agent);
  return game;
}

/**
 * Initializes the MCP session the way Claude Code does.
 *
 * @param bridge - The bridge.
 * @returns The initialize response.
 */
async function initialize(bridge: Bridge): Promise<Frame> {
  const answer = await bridge.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-bridge.test", version: "1.0.0" }
  });
  bridge.notify("notifications/initialized");
  return answer;
}

/**
 * True when every stdout line is one JSON-RPC 2.0 frame.
 *
 * @param bridge - The bridge.
 * @returns Whether stdout carried only frames.
 */
function onlyFrames(bridge: Bridge): boolean {
  return bridge.lines.every(line => {
    try {
      return JSON.parse(line).jsonrpc === "2.0";
    } catch {
      return false;
    }
  });
}

beforeAll(async () => {
  if (!existsSync(path.join(REPO, "dist", "tools", "index.html"))) {
    const build = Bun.spawn(["bun", "scripts/build-tools.ts"], {
      cwd: REPO,
      stdout: "ignore",
      stderr: "ignore"
    });
    expect(await build.exited).toBe(0);
  }
}, 120_000);

afterEach(async () => {
  for (const app of apps.splice(0)) await app.stop().catch(() => undefined);
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
    await child.exited;
  }
  await shutdown();
});

describe("moku-editor mcp over stdio", () => {
  it("drives a running bin: initialize, tools, read, run, screenshot, files; stdin end leaves the bin running", async () => {
    const root = await createProject("tiny");
    const html = await writeGamePage(root);
    const bin = await startBin(root, html);
    const origin = bin.discovery.url;
    await startTinyAgent(origin);
    const bridge = startBridge(["--root", root], root);

    const init = await initialize(bridge);
    expect(init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "moku-editor" }
    });

    const list = await bridge.request("tools/list");
    const names = (list.result as { tools: { name: string }[] }).tools.map(tool => tool.name);
    expect(names).toHaveLength(15);
    expect(names).toEqual(
      expect.arrayContaining(["moku_read", "moku_run", "moku_screenshot", "moku_files_read"])
    );

    await until(
      async () => textOf(await bridge.call("moku_sessions")).includes(TINY_NAME),
      "the tiny game session in moku_sessions",
      SLOW_MS
    );

    const position = await bridge.call("moku_read", { id: "game.position" });
    expect(position.isError).toBeUndefined();
    expect(JSON.parse(textOf(position))).toMatchObject({ path: "home" });

    const pause = await bridge.call("moku_run", { id: "game.pause" });
    expect(pause.isError).toBeUndefined();
    expect(textOf(pause)).toMatch(/^effect: /);
    const resume = await bridge.call("moku_run", { id: "game.resume" });
    expect(resume.isError).toBeUndefined();
    expect(textOf(resume)).toMatch(/^effect: /);

    // The headless tiny game has no renderer: the picture tools end in a clear message.
    const shot = await bridge.call("moku_screenshot");
    expect(shot.isError).toBe(true);
    expect(textOf(shot)).toMatch(/game\.capture|paused or hidden/);
    const sheet = await bridge.call("moku_series", { frames: 2, everyMs: 16 });
    expect(sheet.isError).toBe(true);
    expect(textOf(sheet)).toMatch(/game\.capture|paused or hidden/);

    const note = await bridge.call("moku_files_read", { path: FIRST_NOTE });
    expect(note.isError).toBeUndefined();
    expect(JSON.parse(textOf(note))).toMatchObject({
      path: FIRST_NOTE,
      version: expect.any(String)
    });
    expect(note.content[1]?.text).toContain("The tiny game pays five coins per visit.");
    const secret = await bridge.call("moku_files_read", { path: ".moku/editor.json" });
    expect(secret.isError).toBe(true);

    expect(await bridge.close()).toBe(0);
    expect(onlyFrames(bridge)).toBe(true);
    expect(bridge.stderr()).not.toContain(
      JSON.parse(await readFile(path.join(root, ".moku", "editor.json"), "utf8")).token
    );
    expect(isAlive(bin.discovery.pid)).toBe(true);
    expect(await readDiscovery(root)).toMatchObject({ pid: bin.discovery.pid });
    const hello = await fetch(`${origin}${HUB_PATH}/hello`, { headers: { origin } });
    expect(hello.status).toBe(200);
  }, 90_000);

  it("answers the screenshot and the contact sheet as images when the game draws", async () => {
    const root = await createProject("tiny");
    const bin = await startBin(root, await writeGamePage(root));
    await startTinyAgent(bin.discovery.url, PNG_1X1);
    const bridge = startBridge(["--root", root], root);
    await initialize(bridge);
    await until(
      async () => textOf(await bridge.call("moku_sessions")).includes(TINY_NAME),
      "the tiny game session in moku_sessions",
      SLOW_MS
    );

    const shot = await bridge.call("moku_screenshot");
    expect(shot.isError).toBeUndefined();
    expect(JSON.parse(textOf(shot))).toMatchObject({ maxWidth: 1080, frame: expect.any(Number) });
    expect(shot.content[1]).toEqual({
      type: "image",
      data: PNG_1X1.slice("data:image/png;base64,".length),
      mimeType: "image/png"
    });

    const sheet = await bridge.call("moku_series", { frames: 4, everyMs: 100 });
    expect(sheet.isError).toBeUndefined();
    expect(JSON.parse(textOf(sheet))).toMatchObject({
      frames: 4,
      everyMs: 100,
      columns: 2,
      maxWidth: 1080
    });
    expect(sheet.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });

    expect(await bridge.close()).toBe(0);
  }, 90_000);

  it("starts the bin itself when none runs, and stops it on stdin end", async () => {
    const root = await createProject("tiny");
    const html = await writeGamePage(root);
    const port = await freePort();
    const bridge = startBridge([html, "--port", String(port), "--root", root], root);

    await initialize(bridge);
    await until(
      async () => JSON.parse(textOf(await bridge.call("moku_status"))).running === true,
      "the bin the bridge started",
      SLOW_MS
    );
    const status = JSON.parse(textOf(await bridge.call("moku_status")));
    expect(status).toMatchObject({ running: true, owned: true, port });
    const started = await readDiscovery(root);
    if (started === undefined) throw new Error("no discovery file");

    expect(await bridge.close()).toBe(0);
    await until(() => !isAlive(started.pid), "the started bin to stop", 5000);
    expect(existsSync(path.join(root, ".moku", "editor.json"))).toBe(false);
    expect(onlyFrames(bridge)).toBe(true);
  }, 90_000);

  it("on SIGTERM tears down like on stdin end: exit 0 and the bin it started stops", async () => {
    const root = await createProject("tiny");
    const html = await writeGamePage(root);
    const bridge = startBridge([html, "--port", String(await freePort()), "--root", root], root);

    await initialize(bridge);
    await until(
      async () => JSON.parse(textOf(await bridge.call("moku_status"))).owned === true,
      "the bin the bridge started",
      SLOW_MS
    );
    const started = await readDiscovery(root);
    if (started === undefined) throw new Error("no discovery file");

    bridge.child.kill("SIGTERM");
    expect(await bridge.child.exited).toBe(0);
    await until(() => !isAlive(started.pid), "the started bin to stop", 5000);
    expect(bridge.stderr()).toContain("stopped by a signal");
  }, 90_000);
});
