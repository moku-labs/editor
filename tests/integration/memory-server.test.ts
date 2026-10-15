/* eslint-disable unicorn/no-null -- localStorage answers null for a missing key; null is "between frames" in a line */
import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "../../src/agent";
import { bridgePlugin, createApp as createPhoneApp } from "../../src/agent";
import {
  createFakeMonitor,
  eventLine,
  type FakeMonitor,
  frameRecord,
  markLine,
  spikeLine
} from "../fixtures/fake-monitor";
import { startTinyHeadless, type TinyHeadless } from "../fixtures/tiny-screen-game";
import { heapMeasured, logLeak, measureGrowth } from "./helpers/heap";
import { createProject, removeTemps, type ServerStack, startServer, until } from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// M3 (spec 10, Delta 2026-10-16): the server stack keeps no session, socket or
// file it does not mean to. The real server core (files, hub, collector, pages
// on Bun.serve) in device mode, and a phone that is the real agent core with
// the opt-in bridge over the headless tiny game, its monitor a fake: 5 000 perf
// records and 20 000 log lines go through the recorder (1 MB logs, so it
// rotates) and the collector; then 50 links connect and disconnect. Open files
// are counted in /dev/fd (Bun's process.getActiveResourcesInfo() lists none).
// Each test prints its numbers (`[leak] …`).
// ─────────────────────────────────────────────────────────────────────────────

/** Bytes in a MiB. */
const MIB = 1024 * 1024;

/** The test's own bound: real sockets and files, on a loaded machine. */
const TEST_MS = 60_000;

/** How long one step may wait for the lines or a link. */
const STEP_MS = 10_000;

/** Spike records and log lines per step: 10 steps make 5 000 records and 20 000 lines. */
const RECORDS = 500;
const LOGS = 2000;

/** The steps before the baseline read: the first log rotated, the phone and the server warm. */
const WARMUP_STEPS = 2;

/** The shell's Origin (Android): a device upgrade needs it. */
const SHELL_ORIGIN = "http://tauri.localhost";

/** One spike record and two small log lines, built once (the engine's lines are frozen too). */
const SPIKE = spikeLine(frameRecord(4812));
const MARK = markLine("boss");
const EVENT = eventLine("devtools", null, { mode: "card", tab: "frames" });

/** The platform WebSocket, wrapped below. */
const PlatformSocket = globalThis.WebSocket;

/** The WebView's WebSocket: it sends the shell's Origin (the bridge passes none in device mode). */
class ShellSocket extends PlatformSocket {
  constructor(url: string | URL) {
    const options: unknown = { headers: { origin: SHELL_ORIGIN } };
    super(url, options as string);
  }
}

let game: TinyHeadless;
let monitor: FakeMonitor;
let server: ServerStack | undefined;
const phones: { stop(): Promise<void> }[] = [];
const storage = new Map<string, string>();

beforeEach(async () => {
  // A plain --debug build on a phone: DEV false, AGENT true, CONTROL false.
  vi.stubGlobal("__MOKU_GAME_DEV__", false);
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);
  vi.stubGlobal("__MOKU_GAME_CONTROL__", false);
  vi.stubGlobal("__MOKU_GAME_ENGINE__", "0.15.0+memory");
  vi.stubGlobal("__MOKU_GAME_BUILD__", "debug-20261016T000000Z");
  vi.stubGlobal("WebSocket", ShellSocket);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  game = await startTinyHeadless();
  monitor = createFakeMonitor({ capacity: 64 });
});

afterEach(async () => {
  for (const phone of phones.splice(0).toReversed()) await phone.stop().catch(() => undefined);
  await server?.stop();
  server = undefined;
  await game.stop();
  await removeTemps();
  vi.unstubAllGlobals();
  storage.clear();
});

/**
 * Starts the server core on a tiny project in device mode (adb missing, so its loop stops at once)
 * and points the phone's build at its adb listener.
 *
 * @returns The running stack.
 */
async function startComputer(): Promise<ServerStack> {
  const root = await createProject("tiny");
  const stack = await startServer(root, {
    hub: { devicePort: 0 },
    collector: { out: "perf", adb: "moku-memory-no-adb" }
  });
  server = stack;
  const listen = await stack.app.hub.listenDevices({ confirm: async () => true });
  vi.stubGlobal("__MOKU_GAME_EDITOR__", listen.adb);
  return stack;
}

/**
 * Starts the phone: the agent core with the bridge over the game, the monitor grafted on as its
 * renderer; the recorder in memory with 1 MB logs and, when asked, recording from the start.
 *
 * @param record - Whether the recorder starts a log at start.
 * @returns The started app.
 */
async function startPhone(record: boolean) {
  const grafted: Registry.GameLike = Object.create(game.app, { renderer: { value: { monitor } } });
  const app = createPhoneApp({
    plugins: [bridgePlugin],
    pluginConfigs: {
      registry: { game: grafted, name: "tiny-screen 0.0.0" },
      recorder: {
        storage: "memory",
        autoStart: record,
        flushEveryMs: 100,
        maxLogMb: 1,
        keepMb: 4,
        keepFiles: 1
      },
      bridge: { retryMs: 100, callTimeoutMs: 2000, linesPerBatch: 1000 }
    }
  });
  app.log.clearSinks();
  await app.start();
  await until(() => app.bridge.link()?.mode === "adb", "the phone linked over adb", STEP_MS);
  return app;
}

/**
 * The lines the collector wrote, over every log of this run.
 *
 * @param stack - The server.
 * @returns The sum.
 */
function written(stack: ServerStack): number {
  let lines = 0;
  for (const session of stack.app.collector.sessions()) lines += session.lines;
  return lines;
}

/**
 * The process's open file descriptors.
 *
 * @returns How many.
 */
function openFiles(): number {
  return readdirSync("/dev/fd").length;
}

describe("server stack memory (M3)", () => {
  it("5 000 perf records and 20 000 log lines through the recorder (rotating 1 MB logs) and the collector keep the heap and the open files flat (bug: a rotated log handle never closed, a session kept)", {
    timeout: TEST_MS
  }, async () => {
    const stack = await startComputer();
    const files = openFiles();
    const phone = await startPhone(true);
    phones.push(phone);
    let emitted = 0;
    let linkedFiles = 0;

    const step = async (round: number): Promise<void> => {
      // Linked: the two ends of the socket and the current log's file. Rotations add none.
      if (round === WARMUP_STEPS) linkedFiles = openFiles();
      for (let index = 0; index < RECORDS; index += 1) {
        monitor.emit(SPIKE);
        for (let log = 0; log < LOGS / RECORDS; log += 1) {
          monitor.emit(log % 2 === 0 ? MARK : EVENT);
        }
      }
      emitted += RECORDS + LOGS;
      await until(
        () => written(stack) >= emitted && phone.recorder.status().pending === 0,
        `${String(emitted)} lines written by the collector`,
        STEP_MS
      ).catch((error: unknown) => {
        throw new Error(`${String(error)}: ${progressOf(stack, phone.recorder.status())}`);
      });
    };

    const ceiling = { heapBytes: 4 * MIB };
    const growth = await measureGrowth(step, {
      warmup: WARMUP_STEPS,
      rounds: 10 - WARMUP_STEPS,
      settle: () => settleServer(stack),
      ceiling
    });
    const rotatedFiles = openFiles() - linkedFiles;
    const logs = stack.app.collector.sessions().length;
    const { dropped } = phone.recorder.status();

    await phone.stop();
    phones.length = 0;
    await until(
      () => stack.app.collector.sessions().every(session => session.state !== "live"),
      "every log away",
      STEP_MS
    );
    await stack.app.collector.settled();
    const filesLeft = openFiles() - files;
    logLeak("server stack, 25 000 lines through recorder and collector", {
      ...growth,
      counts: { logs, "files after rotations": rotatedFiles, "files left": filesLeft, dropped }
    });

    expect(written(stack)).toBeGreaterThanOrEqual(25_000);
    expect(dropped).toBe(0);
    // 1 MB logs: the recorder rotated, and the collector closed each finished log's file.
    expect(logs).toBeGreaterThanOrEqual(5);
    expect(rotatedFiles).toBeLessThanOrEqual(0);
    expect(filesLeft).toBeLessThanOrEqual(0);
    expect(stack.app.hub.sessions()).toEqual([]);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(ceiling.heapBytes);
  });

  it("50 link connect/disconnect cycles leave no session, socket or file behind (bug: a session or socket kept after a disconnect)", {
    timeout: TEST_MS
  }, async () => {
    const stack = await startComputer();
    // The first link pairs; every later one comes back with the device token.
    const first = await startPhone(false);
    await first.stop();
    await until(() => stack.app.hub.sessions().length === 0, "the paired phone gone", STEP_MS);
    const sessions = stack.app.hub.sessions().length;
    const files = openFiles();

    const cycle = async (): Promise<void> => {
      const phone = await startPhone(false);
      await phone.stop();
      await until(
        () => stack.app.hub.sessions().length === sessions,
        "the phone's session closed",
        STEP_MS
      );
    };

    // The heap takes one-time steps in the first hundred links or so (a few hundred functions and
    // objects, the same for 50 or 100 more links): the warmup covers them.
    const ceiling = { heapBytes: 4 * MIB, objects: 500 };
    const growth = await measureGrowth(cycle, {
      warmup: 150,
      rounds: 50,
      settle: () => settleServer(stack),
      ceiling
    });
    const filesLeft = openFiles() - files;
    const sessionsLeft = stack.app.hub.sessions().length - sessions;
    const devices = stack.app.hub.devices();
    logLeak("server stack, 50 link cycles", {
      ...growth,
      counts: { "sessions left": sessionsLeft, devices: devices.length, "files left": filesLeft }
    });

    expect(sessionsLeft).toBe(0);
    expect(devices).toMatchObject([{ online: false }]);
    expect(filesLeft).toBeLessThanOrEqual(0);
    if (growth.objects !== undefined) expect(growth.objects).toBeLessThan(ceiling.objects);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(ceiling.heapBytes);
  });
});

/**
 * Before a heap read: the collector's queued writes done, and what is kept on purpose emptied, so
 * the count is the editor's own objects: the server log's trace (`@moku-labs/common`'s log keeps
 * every entry for `trace()` until `reset()`, a few per link, by that package's design) and what
 * the stack helper records (every `hub:session` payload, the wire tap).
 *
 * @param stack - The server.
 */
async function settleServer(stack: ServerStack): Promise<void> {
  await stack.app.collector.settled();
  stack.app.log.reset();
  stack.sessions.length = 0;
  stack.written.length = 0;
  stack.tap.entries.length = 0;
  stack.tap.sockets.length = 0;
}

/**
 * What the collector and the recorder hold now, for a step that timed out.
 *
 * @param stack - The server.
 * @param status - The recorder's status.
 * @returns One line.
 */
function progressOf(stack: ServerStack, status: unknown): string {
  const logs = stack.app.collector
    .sessions()
    .map(({ log, state, lines, lost }) => ({ log, state, lines, lost }));
  return `written ${String(written(stack))}, recorder ${JSON.stringify(status)}, logs ${JSON.stringify(logs)}`;
}
