import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../../registry/protocol";
import { removeDiscovery, writeDiscovery } from "../../../discovery";
import { processBridgeDeps, runBridge } from "../../../mcp/bridge";
import { NOT_RUNNING, RECONNECT_WAITS_MS } from "../../../mcp/connection";
import { GRACE_MS } from "../../../mcp/door-tools";
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
// socket, stops a bin the bridge started (never another one) and exits 0. A
// restart of the bin (close 1012, then a closed port) keeps the door tools and
// prints no warning.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;
let hub: FakeHub;

/** How far the bridge's clock runs ahead of real time, in ms: a test moves it to age a connection. */
let ahead = 0;

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
  ahead = 0;
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
    now: () => Date.now() + ahead,
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
  let lastId = 100;
  /** Sends a request with a fresh id and waits for its answer. */
  const ask = async (method: string, params?: object): Promise<RpcFrame | undefined> => {
    lastId += 1;
    const id = lastId;
    stdin.send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    await until(() => answer(id) !== undefined, `the answer of ${method}`);
    return answer(id);
  };
  /** How many `list_changed` notifications went out. */
  const changes = (): number =>
    frames().filter(frame => frame.method === "notifications/tools/list_changed").length;
  /** How many stderr lines hold a text. */
  const logged = (text: string): number => stderr.filter(line => line.includes(text)).length;
  return {
    stdin,
    writes,
    stderr,
    spawn,
    children,
    done,
    frames,
    answer,
    ask,
    changes,
    logged,
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

/** The text of a connect that failed, and of the stderr line of each connect and each close. */
const NO_CONNECT = "could not connect to moku-editor";
const CONNECTED = "connected to";
const CLOSED = "connection closed";

/** The stderr line of a close that starts the reconnect tries, and of one without a bin. */
const CLOSED_LINE = "  › moku-editor mcp: the moku-editor connection closed; reconnecting";
const CLOSED_NO_BIN_LINE =
  "  › moku-editor mcp: the moku-editor connection closed; no running moku-editor";

/** The stderr line of a connect to the fake hub. */
function connectedLine(): string {
  return `  › moku-editor mcp: connected to ${hub.url}`;
}

/** The one warning of reconnect tries that ended on the closed port of the fake hub. */
function gaveUpLine(): string {
  return `  ⚠ [moku-editor] mcp: could not reconnect to moku-editor; the next tool call tries again.\n  Last attempt: [moku-editor] ${NO_CONNECT} at ${hub.url}: the socket closed.`;
}

/** The hashes of game A and game B, and the door tools of game A. */
const HASH_A = "aaaa0001";
const HASH_B = "bbbb0002";
const DOORS_A = ["game_tap", "cheat_game_fill"];

/** The door tools a client sees now: a fresh tools/list without the generic tools. */
async function doorsOf(run: ReturnType<typeof bridge>): Promise<string[]> {
  const names = toolsOf(await run.ask("tools/list")).map(tool => tool.name);
  return names.filter(name => !name.startsWith("moku_"));
}

/** The first line of the answer of a tool call. */
async function callOf(run: ReturnType<typeof bridge>, name: string, args: Json): Promise<string> {
  const frame = await run.ask("tools/call", { name, arguments: args });
  return toolText(frame).split("\n")[0] ?? "";
}

/** Whether a check passes within 2 s: a wait that reads false instead of throwing. */
async function comes(check: () => boolean): Promise<boolean> {
  return until(check, "").then(
    () => true,
    () => false
  );
}

/** Lets the pending promise callbacks run (real setImmediate, also under fake timeouts). */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
  }
}

/** What moku_status answers: the hint while no connection is open, the sessions while one is. */
type Status = {
  readonly running: boolean;
  readonly hint?: string;
  readonly sessions?: readonly { readonly id: string }[];
};

/** The answer of moku_status. */
async function statusOf(run: ReturnType<typeof bridge>): Promise<Status> {
  const frame = await run.ask("tools/call", { name: "moku_status", arguments: {} });
  return JSON.parse(toolText(frame));
}

/**
 * Whether the reconnect try in flight ended without a connection. A failed try prints nothing, but
 * a tool call answers after it: moku_status waits for the try, then finds the port closed itself.
 */
async function tryFailed(run: ReturnType<typeof bridge>): Promise<boolean> {
  const { running, hint = "" } = await statusOf(run);
  return !running && hint.includes(NO_CONNECT);
}

/** Whether the bridge lists exactly these sessions within 2 s: its hub client got the push. */
async function lists(run: ReturnType<typeof bridge>, ids: readonly string[]): Promise<boolean> {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    const { sessions = [] } = await statusOf(run);
    if (sessions.map(entry => entry.id).join(",") === ids.join(",")) return true;
    await Bun.sleep(10);
  }
  return false;
}

/**
 * The bin's restart begins: every socket closes with 1012, then the port. Resolves once the bridge
 * saw the close and its try at the close ended.
 *
 * @returns Whether that try failed.
 */
async function portCloses(run: ReturnType<typeof bridge>): Promise<boolean> {
  await hub.goAway();
  await until(() => run.logged(CLOSED) === 1, "the close");
  return tryFailed(run);
}

/**
 * The first 5.5 s of a restart: the port is closed, and the bridge's tries at the close and 1 and
 * 3 s after it fail.
 *
 * @returns Whether each of the three tries failed.
 */
async function closedPort(run: ReturnType<typeof bridge>): Promise<boolean[]> {
  const tries = [await portCloses(run)];
  for (const wait of [1000, 2000]) {
    await vi.advanceTimersByTimeAsync(wait);
    tries.push(await tryFailed(run));
  }
  await vi.advanceTimersByTimeAsync(2500);
  return tries;
}

/**
 * The end of a restart, after `closedPort`: the port opens 6 s after the close, and the bridge's
 * try at 7 s connects.
 *
 * @returns Whether the bridge connected again.
 */
async function openPort(run: ReturnType<typeof bridge>): Promise<boolean> {
  await vi.advanceTimersByTimeAsync(500);
  hub.comeBack();
  await vi.advanceTimersByTimeAsync(1000);
  return comes(() => run.logged(CONNECTED) === 2);
}

/**
 * A bridge on the running bin whose client listed the doors of game A (session s-1; s-2 is game
 * B). Its connection is a minute old, so a close starts the reconnect tries at once.
 */
async function listedBridge() {
  hub.setSessions([session("s-1", { manifestHash: HASH_A })]);
  hub.handle("game.manifest", (_params, asked) => (asked === "s-2" ? GAME_B : GAME_A));
  hub.handle("game.run", () => ({
    value: true,
    state: { path: "home", frame: 12, tainted: false }
  }));
  writeDiscovery(root, hub.discovery(root));
  const run = bridge();
  await run.ask("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t" }
  });
  run.stdin.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  expect(await doorsOf(run)).toEqual(DOORS_A);
  ahead += 60_000;
  return run;
}

describe("a restart of the bin (D-32, D-57, D-59)", () => {
  // The grace of the doors and the waits between the reconnect tries run on fake time; the
  // sockets and `until` on real time. A failed try prints nothing, so a test waits for it with a
  // tool call (`tryFailed`).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has a grace of the doors that outlasts the last reconnect try: 8 s, the tries 0, 1, 3 and 7 s after the close", () => {
    const lastTry = RECONNECT_WAITS_MS.reduce((sum, wait) => sum + wait, 0);
    expect({ lastTry, grace: GRACE_MS }).toEqual({ lastTry: 7000, grace: 8000 });
  });

  it("keeps the doors over a restart that closes the port for 6 s: no list_changed, no warning, and the doors run right after", async () => {
    const run = await listedBridge();
    const before = run.stderr.length;

    // The restart closes every socket with 1012, then the port. The bridge tries at the close,
    // then 1 s and 3 s after it: all three find the port closed.
    const tries = await closedPort(run);
    const closed = { doors: await doorsOf(run), changes: run.changes() };

    // The port opens 6 s after the close, with the same game. The try at 7 s connects.
    const reconnected = await openPort(run);
    const open = {
      doors: await doorsOf(run),
      door: await callOf(run, "game_tap", { target: "play" }),
      generic: await callOf(run, "moku_manifest", {}),
      changes: run.changes(),
      timers: vi.getTimerCount()
    };

    expect({ tries, closed, reconnected, open }).toEqual({
      tries: [true, true, true],
      closed: { doors: DOORS_A, changes: 0 },
      reconnected: true,
      open: { doors: DOORS_A, door: "effect: route", generic: "{", changes: 0, timers: 0 }
    });
    // An expected restart prints the close and the connect, and no warning.
    expect(run.stderr.slice(before)).toEqual([CLOSED_LINE, connectedLine()]);
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
  }, 20_000);

  it("gives the doors a full grace from the reconnect that found no session: the game back 8.4 s after the close sends no list_changed", async () => {
    const run = await listedBridge();

    // The bridge is back 7 s after the close, before the game page: the hub has no session yet.
    await closedPort(run);
    hub.setSessions([]);
    const reconnected = await openPort(run);

    // The third try of the game page lands up to 8.4 s after the close, past 8 s from the close.
    await vi.advanceTimersByTimeAsync(1400);
    const waiting = { doors: await doorsOf(run), changes: run.changes() };
    hub.setSessions([session("s-3", { manifestHash: HASH_A })]);
    const listed = await lists(run, ["s-3"]);
    await vi.advanceTimersByTimeAsync(60_000);
    const back = {
      doors: await doorsOf(run),
      door: await callOf(run, "game_tap", { target: "play" }),
      changes: run.changes(),
      timers: vi.getTimerCount()
    };

    expect({ reconnected, waiting, listed, back }).toEqual({
      reconnected: true,
      waiting: { doors: DOORS_A, changes: 0 },
      listed: true,
      back: { doors: DOORS_A, door: "effect: route", changes: 0, timers: 0 }
    });
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
  }, 20_000);

  it("empties the doors once, 8 s after the reconnect that found no session, when the game never comes back: one list_changed, no timer left", async () => {
    const run = await listedBridge();

    await closedPort(run);
    hub.setSessions([]);
    const reconnected = await openPort(run);

    // The reconnect was 7 s after the close: the doors stay until 15 s after it.
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    const kept = { doors: await doorsOf(run), changes: run.changes() };
    await vi.advanceTimersByTimeAsync(1);
    const gone = { doors: await doorsOf(run), changes: run.changes(), timers: vi.getTimerCount() };
    await vi.advanceTimersByTimeAsync(60_000);

    expect({ reconnected, kept, gone, changes: run.changes() }).toEqual({
      reconnected: true,
      kept: { doors: DOORS_A, changes: 0 },
      gone: { doors: [], changes: 1, timers: 0 },
      changes: 1
    });
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
  }, 20_000);

  it("sends one list_changed when the bin comes back with another game", async () => {
    const run = await listedBridge();

    await portCloses(run);
    hub.setSessions([session("s-2", { manifestHash: HASH_B })]);
    hub.comeBack();
    await vi.advanceTimersByTimeAsync(1000);
    await until(() => run.changes() === 1, "the list change");

    expect(await doorsOf(run)).toEqual(["raw_game_restore"]);
    expect(await callOf(run, "game_tap", { target: "play" })).toBe(
      "game_tap is gone: the game changed. Call moku_manifest, or moku_run { id }."
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run.changes()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
  });

  it("empties the doors once, 8 s after the bin is gone: one list_changed, no try, no warning, no timer left, and stdin end exits 0", async () => {
    const run = await listedBridge();
    const before = run.stderr.length;

    // A bin that stops removes its discovery file first, then closes its sockets (1001).
    removeDiscovery(root, process.pid);
    hub.dropClients();
    await until(() => run.logged(CLOSED) === 1, "the close");
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    expect({ doors: await doorsOf(run), changes: run.changes() }).toEqual({
      doors: DOORS_A,
      changes: 0
    });
    await vi.advanceTimersByTimeAsync(1);
    expect({ doors: await doorsOf(run), changes: run.changes() }).toEqual({
      doors: [],
      changes: 1
    });
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(run.changes()).toBe(1);
    // A bin that stopped is one line: nothing was tried, so nothing failed.
    expect(run.stderr.slice(before)).toEqual([CLOSED_NO_BIN_LINE]);
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops after the try at 7 s when the port stays closed: one warning with the last error, the doors go once at 8 s, and no timer is left", async () => {
    const run = await listedBridge();
    const before = run.stderr.length;

    const tries = [await portCloses(run)];
    for (const wait of RECONNECT_WAITS_MS) {
      await vi.advanceTimersByTimeAsync(wait);
      tries.push(await tryFailed(run));
    }
    expect({ tries, timers: vi.getTimerCount(), changes: run.changes() }).toEqual({
      tries: [true, true, true, true],
      timers: 1,
      changes: 0
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect({ doors: await doorsOf(run), changes: run.changes() }).toEqual({
      doors: [],
      changes: 1
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run.changes()).toBe(1);
    // Four failed tries print one warning: the close, then that the tries ended.
    expect(run.stderr.slice(before)).toEqual([CLOSED_LINE, gaveUpLine()]);
    run.stdin.end();
    await expect(run.done).resolves.toBe(0);
  });

  it("leaves no timer when a signal stops the bridge between two tries", async () => {
    const run = await listedBridge();

    await portCloses(run);
    // The next try and the grace of the doors.
    expect(vi.getTimerCount()).toBe(2);

    run.signal();
    await expect(run.done).resolves.toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    hub.comeBack();
    await vi.advanceTimersByTimeAsync(60_000);
    expect({ connects: run.logged(CONNECTED), changes: run.changes() }).toEqual({
      connects: 1,
      changes: 0
    });
  });

  it("closes a connection that opens while a signal stops the bridge: no connect line, no list_changed, no timer left", async () => {
    const run = await listedBridge();

    // The bin is back with another game, but its hub holds the first sessions list: the try 1 s
    // after the close stays in flight.
    await portCloses(run);
    hub.setSessions([session("s-2", { manifestHash: HASH_B })]);
    hub.hold();
    hub.comeBack();
    const upgrades = hub.origins.length;
    await vi.advanceTimersByTimeAsync(1000);
    await until(() => hub.origins.length === upgrades + 1, "the socket of the try");

    // The teardown waits for that try; its connect opens only then.
    run.signal();
    await settle();
    hub.release();
    await expect(run.done).resolves.toBe(0);

    expect({
      connects: run.logged(CONNECTED),
      changes: run.changes(),
      manifests: hub.requests.filter(request => request.session === "s-2").length,
      timers: vi.getTimerCount()
    }).toEqual({ connects: 1, changes: 0, manifests: 0, timers: 0 });
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
