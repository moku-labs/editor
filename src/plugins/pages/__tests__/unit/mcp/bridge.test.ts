import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeDiscovery } from "../../../discovery";
import { processBridgeDeps, runBridge } from "../../../mcp/bridge";
import { NOT_RUNNING } from "../../../mcp/connection";
import type { BridgeDeps, ChildProcess, SpawnProcess } from "../../../mcp/types";
import { VERSION } from "../../../mcp/version";
import type { McpArgs } from "../../../types";
import type { FakeHub } from "../../fake-hub";
import { session, startFakeHub, until } from "../../fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp bridge (D-31): runBridge over fake stdio and a fake hub. stdout
// carries only JSON-RPC frames; stdin end aborts pending calls, closes the
// socket, stops a bin the bridge started (never another one) and exits 0.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;
let hub: FakeHub;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "moku-mcp-bridge-"));
  hub = startFakeHub({ sessions: [session("s-1")], hotReload: { hmr: true, owner: "bin" } });
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
    now: Date.now
  };
  const done = runBridge({ kind: "mcp", root, hmr: true, ...args }, deps);
  /** The parsed frames so far. */
  const frames = (): { id?: unknown; result?: unknown; error?: unknown; method?: string }[] =>
    writes.map(text => JSON.parse(text));
  /** The frame answering `id`. */
  const answer = (id: number) => frames().find(frame => frame.id === id);
  return { stdin, writes, stderr, spawn, children, done, frames, answer };
}

/** The first text of a tools/call answer. */
function toolText(frame: { result?: unknown } | undefined): string {
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
