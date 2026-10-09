import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../../registry/protocol";
import { writeDiscovery } from "../../../discovery";
import { processBridgeDeps, runBridge } from "../../../mcp/bridge";
import { NOT_RUNNING } from "../../../mcp/connection";
import { SESSION_PROPERTY } from "../../../mcp/schema";
import { TOOLS } from "../../../mcp/tools";
import type { BridgeDeps, ChildProcess, SpawnProcess } from "../../../mcp/types";
import { VERSION } from "../../../mcp/version";
import type { McpArgs } from "../../../types";
import type { FakeHub } from "../../fake-hub";
import { session, startFakeHub, until } from "../../fake-hub";
import type { RpcFrame } from "../../rpc-frame";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp bridge (D-31): runBridge over fake stdio and a fake hub. stdout
// carries only JSON-RPC frames; stdin end aborts pending calls, closes the
// socket, stops a bin the bridge started (never another one) and exits 0.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;
let hub: FakeHub;

/** The manifest of a game with the given commands. */
function gameWith(commands: Json[]): Json {
  return {
    game: "tiny-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded: true,
    sources: [],
    commands
  };
}

/** A game with a route door and a cheat door, and a game with a raw door only. */
const GAME_A = gameWith([
  {
    id: "game.tap",
    title: "Tap a target",
    input: { target: "string", x: "number?" },
    effect: "route"
  },
  { id: "game.fill", title: "Fill the board", input: { board: "json" }, effect: "cheat" }
]);
const GAME_B = gameWith([
  { id: "game.restore", title: "Restore a bookmark", input: { bookmark: "string" }, effect: "raw" }
]);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "moku-mcp-bridge-"));
  hub = startFakeHub({ sessions: [session("s-1")], hotReload: { hmr: true, owner: "bin" } });
  hub.handle("game.manifest", () => GAME_A);
});

afterEach(async () => {
  await hub.stop();
  await rm(root, { recursive: true, force: true });
});

/** A stdin the test feeds line by line and ends. */
function fakeStdin() {
  const queue: string[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  /**
   * Yields the queued lines until the end.
   *
   * @yields {string} Each line with its newline.
   */
  async function* lines(): AsyncGenerator<string> {
    for (;;) {
      const next = queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (ended) return;
      await new Promise<void>(resolve => {
        wake = resolve;
      });
    }
  }
  return {
    input: lines(),
    send: (message: object) => {
      queue.push(`${JSON.stringify(message)}\n`);
      wake?.();
    },
    end: () => {
      ended = true;
      wake?.();
    }
  };
}

/** A fake child that exits on a signal. */
function fakeChild(pid: number) {
  const { promise: exited, resolve: exit } = Promise.withResolvers<number>();
  const signals: string[] = [];
  const child: ChildProcess = {
    pid,
    exited,
    kill: name => {
      signals.push(name);
      exit(0);
    },
    unref: vi.fn()
  };
  return { child, signals };
}

/**
 * Runs the bridge with fake deps.
 *
 * @param args - The mcp arguments (root is the temp root).
 */
function bridge(args: Partial<McpArgs> = {}) {
  const stdin = fakeStdin();
  const writes: string[] = [];
  const stderr: string[] = [];
  const children: ReturnType<typeof fakeChild>[] = [];
  const alive = new Set([process.pid]);
  const spawn = vi.fn<SpawnProcess>(() => {
    const made = fakeChild(8100 + children.length);
    children.push(made);
    alive.add(made.child.pid);
    setTimeout(() => writeDiscovery(root, hub.discovery(root, made.child.pid)), 20);
    return made.child;
  });
  const stops = new Set<() => void>();
  const onSignal = vi.fn((stop: () => void) => {
    stops.add(stop);
    return () => stops.delete(stop);
  });
  const releaseInput = vi.fn();
  const deps: BridgeDeps = {
    input: stdin.input,
    write: text => writes.push(text),
    ui: createBrandConsole({
      write: line => stderr.push(line),
      writeError: line => stderr.push(line),
      color: false
    }),
    spawn,
    isAlive: pid => alive.has(pid),
    command: ["bun", "bin.mjs"],
    now: Date.now,
    onSignal,
    releaseInput
  };
  const done = runBridge({ kind: "mcp", root, hmr: true, ...args }, deps);
  /** Plays a SIGINT or SIGTERM: every stop still listening is called. */
  const signal = (): void => {
    for (const stop of stops) stop();
  };
  /** The parsed frames so far. */
  const frames = (): RpcFrame[] => writes.map(text => JSON.parse(text));
  /** The frame answering `id`. */
  const answer = (id: number) => frames().find(frame => frame.id === id);
  return {
    stdin,
    writes,
    stderr,
    spawn,
    children,
    done,
    frames,
    answer,
    signal,
    stops,
    releaseInput
  };
}

/** The first text of a tools/call answer. */
function toolText(frame: RpcFrame | undefined): string {
  const result = frame?.result;
  if (typeof result !== "object" || result === null || !("content" in result)) return "";
  const [first] = Array.isArray(result.content) ? result.content : [];
  return typeof first === "object" && first !== null && "text" in first ? String(first.text) : "";
}

describe("runBridge", () => {
  it("serves initialize, tools/list and tools/call on a running bin; stdout carries only frames", async () => {
    writeDiscovery(root, hub.discovery(root));
    const run = bridge();
    run.stdin.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t" } }
    });
    run.stdin.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    run.stdin.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    run.stdin.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "moku_status", arguments: {} }
    });
    await until(() => run.answer(3) !== undefined, "the status");
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);

    for (const text of run.writes) {
      expect(text.endsWith("\n")).toBe(true);
      expect(text.slice(0, -1)).not.toContain("\n");
      expect(JSON.parse(text)).toMatchObject({ jsonrpc: "2.0" });
    }
    expect(run.answer(1)).toMatchObject({
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "moku-editor", version: VERSION }
      }
    });
    expect(run.answer(2)).toMatchObject({ result: { tools: expect.any(Array) } });
    expect(JSON.parse(toolText(run.answer(3)))).toMatchObject({
      running: true,
      owned: false,
      sessions: [session("s-1")]
    });
    expect(run.stderr.join("\n")).toContain(`connected to ${hub.url}`);
    expect(run.stderr.join("\n")).not.toContain(hub.discovery(root).token);
    expect(run.spawn).not.toHaveBeenCalled();
  });

  it("aborts a pending moku_wait on stdin end and sends no answer for it", async () => {
    writeDiscovery(root, hub.discovery(root));
    const run = bridge();
    run.stdin.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "moku_wait", arguments: { id: "game.position", timeoutMs: 20_000 } }
    });
    await until(() => hub.watched().length === 1, "the watch");
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
    expect(run.answer(5)).toBeUndefined();
  });

  it("starts the bin from its html, and stops it (only it) on stdin end", async () => {
    const run = bridge({ html: "web/index.html", port: 4600 });
    run.stdin.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "moku_status" }
    });
    await until(() => run.answer(1) !== undefined, "the status");
    expect(JSON.parse(toolText(run.answer(1)))).toMatchObject({ running: true, owned: true });
    expect(run.spawn.mock.calls[0]?.[0]).toContain("4600");
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
    expect(run.children[0]?.signals).toEqual(["SIGTERM"]);
  });

  it("tears down on SIGINT or SIGTERM like on stdin end: stops the bin it started and resolves 0", async () => {
    const run = bridge({ html: "web/index.html", port: 4601 });
    run.stdin.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "moku_status" }
    });
    await until(() => run.answer(1) !== undefined, "the status");
    expect(run.stops.size).toBe(1);

    run.signal();
    run.signal();
    await expect(run.done).resolves.toBe(0);

    expect(run.children[0]?.signals).toEqual(["SIGTERM"]);
    expect(run.releaseInput).toHaveBeenCalledOnce();
    expect(run.stops.size).toBe(0);
    expect(run.stderr.join("\n")).toContain("moku-editor mcp: stopped by a signal");
  });

  it("aborts a pending moku_wait on a signal and answers no line sent after it", async () => {
    writeDiscovery(root, hub.discovery(root));
    const run = bridge();
    run.stdin.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "moku_wait", arguments: { id: "game.position", timeoutMs: 20_000 } }
    });
    await until(() => hub.watched().length === 1, "the watch");
    run.signal();
    run.stdin.send({ jsonrpc: "2.0", id: 6, method: "ping" });
    await expect(run.done).resolves.toBe(0);
    expect(run.answer(5)).toBeUndefined();
    expect(run.answer(6)).toBeUndefined();
    expect(run.spawn).not.toHaveBeenCalled();
  });

  it("does not let go of stdin when stdin itself ended", async () => {
    const run = bridge();
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
    expect(run.releaseInput).not.toHaveBeenCalled();
    expect(run.stops.size).toBe(0);
    expect(run.stderr.join("\n")).toContain("moku-editor mcp: stdin closed");
  });

  it("answers the game tools with the not-running message when no bin runs", async () => {
    const run = bridge();
    run.stdin.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "moku_read", arguments: { id: "game.position" } }
    });
    await until(() => run.answer(1) !== undefined, "the answer");
    run.stdin.end();
    await run.done;
    expect(run.answer(1)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: NOT_RUNNING }], isError: true }
    });
  });
});

/** The tools of a tools/list answer. */
function toolsOf(frame: RpcFrame | undefined): { name: string }[] {
  const result = frame?.result;
  if (typeof result !== "object" || result === null || !("tools" in result)) return [];
  return Array.isArray(result.tools) ? result.tools : [];
}

describe("door tools (D-35, D-36, D-37)", () => {
  it("lists the command doors of the game with their schemas, and sends one list_changed for another command set", async () => {
    hub.setSessions([session("s-1", { manifestHash: "aaaa0001" })]);
    hub.handle("game.manifest", (_params, asked) => (asked === "s-2" ? GAME_B : GAME_A));
    writeDiscovery(root, hub.discovery(root));
    const run = bridge();
    run.stdin.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t" } }
    });
    run.stdin.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    run.stdin.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await until(() => run.answer(2) !== undefined, "the first tools/list");

    const generic = TOOLS.map(tool => tool.name);
    const first = toolsOf(run.answer(2));
    expect(first.map(tool => tool.name)).toEqual([...generic, "game_tap", "cheat_game_fill"]);
    expect(first.find(tool => tool.name === "game_tap")).toEqual({
      name: "game_tap",
      title: "Tap a target",
      description:
        '[route] Tap a target. Command door game.tap of tiny-game 0.0.0. Same as moku_run { id: "game.tap" }.',
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "string input of the door" },
          x: { type: "number", description: "number input of the door" },
          _session: SESSION_PROPERTY
        },
        required: ["target"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    });
    expect(first.find(tool => tool.name === "cheat_game_fill")).toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    });

    const changes = (): number =>
      run.frames().filter(frame => frame.method === "notifications/tools/list_changed").length;
    const before = changes();
    hub.setSessions([session("s-2", { manifestHash: "bbbb0002" })]);
    await until(() => changes() === before + 1, "the list change");
    run.stdin.send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    run.stdin.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "game_tap", arguments: { target: "play" } }
    });
    await until(() => run.answer(4) !== undefined, "the call of a retired door");
    expect(toolsOf(run.answer(3)).map(tool => tool.name)).toEqual([...generic, "raw_game_restore"]);
    expect(run.answer(4)).toMatchObject({ result: { isError: true } });
    expect(toolText(run.answer(4))).toBe(
      "game_tap is gone: the game changed. Call moku_manifest, or moku_run { id }."
    );

    hub.setSessions([
      session("s-2", {
        manifestHash: "bbbb0002",
        heartbeat: { frame: 4, paused: true, silent: false }
      })
    ]);
    await Bun.sleep(50);
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
    expect(changes()).toBe(before + 1);
  });

  it("runs a door tool through the hub like moku_run", async () => {
    hub.handle("game.run", () => ({
      value: true,
      state: { path: "home", frame: 12, tainted: false }
    }));
    writeDiscovery(root, hub.discovery(root));
    const run = bridge();
    run.stdin.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await until(() => run.answer(1) !== undefined, "the tools");
    run.stdin.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "game_tap", arguments: { target: "play", x: 0.5 } }
    });
    run.stdin.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "game_tap", arguments: { x: 0.5 } }
    });
    // Answer 3 is refused before the hub is asked, so it comes first. The stdin end aborts a call
    // still in flight and sends no answer for it: wait for answer 2 as well.
    await until(() => run.answer(2) !== undefined && run.answer(3) !== undefined, "the door calls");
    run.stdin.end();
    await run.done;

    expect(toolText(run.answer(2))).toMatch(/^effect: route\n/);
    expect(hub.requests).toContainEqual({
      channel: "game",
      method: "run",
      params: { id: "game.tap", input: { target: "play", x: 0.5 } },
      session: undefined
    });
    expect(run.answer(3)).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: "target is required" }], isError: true }
    });
  });
});

describe("processBridgeDeps signals", () => {
  it("listens to SIGINT and SIGTERM until the remover runs", () => {
    const deps = processBridgeDeps();
    const stop = vi.fn();
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };

    const remove = deps.onSignal(stop);
    expect(process.listenerCount("SIGINT")).toBe(before.int + 1);
    expect(process.listenerCount("SIGTERM")).toBe(before.term + 1);
    process.listeners("SIGTERM").at(-1)?.("SIGTERM");
    expect(stop).toHaveBeenCalledOnce();

    remove();
    expect(process.listenerCount("SIGINT")).toBe(before.int);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
  });

  it("lets go of stdin by destroying it", () => {
    const destroy = vi.spyOn(process.stdin, "destroy").mockImplementation(() => process.stdin);
    try {
      processBridgeDeps().releaseInput();
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      destroy.mockRestore();
    }
  });
});

describe("processBridgeDeps", () => {
  it("reads stdin, runs this runtime and logs only to stderr", () => {
    const deps = processBridgeDeps();
    expect(deps.input).toBe(process.stdin);
    expect(deps.command[0]).toBe(process.execPath);
    expect(deps.isAlive(process.pid)).toBe(true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      deps.ui.info("hello");
      deps.write("{}\n");
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("hello"));
      expect(stdout).toHaveBeenCalledTimes(1);
      expect(stdout).toHaveBeenCalledWith("{}\n");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
