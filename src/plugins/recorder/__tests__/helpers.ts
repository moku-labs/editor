/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's log lines */
import { createApp as createGame, defineGame, type } from "@moku-labs/game";
import { createHeadless, fakeClock, memory } from "@moku-labs/game/testing";
import { vi } from "vitest";
import type { FakeMonitor } from "../../../../tests/fixtures/fake-monitor";
import { createFakeMonitor } from "../../../../tests/fixtures/fake-monitor";
import type { Require } from "../../../config";
import type { PerfLogLine, PerfStartupLine } from "../../perf/protocol";
import { readBuildInfo } from "../../registry/entries/profile";
import type { CommandEntry, GameLike, SourceEntry } from "../../registry/types";
import { createRecorderApi } from "../api";
import { listen } from "../listener";
import { createRecorderState } from "../state";
import type { LogStore } from "../store/types";
import type {
  RecorderApi,
  RecorderConfig,
  RecorderCtx,
  RecorderState,
  RecorderStatusEvent
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the recorder's tests: the fake monitor of tests/fixtures (its
// mark and event lines reach the stream, as the engine's do), a mock ctx with the api over it, readers of the queue and the store, and a
// started headless engine game for the app tests.
// ─────────────────────────────────────────────────────────────────────────────

/** The recorder's defaults, on the memory store. */
export const CONFIG: RecorderConfig = {
  autoStart: true,
  keepMb: 64,
  flushEveryMs: 1000,
  persistEveryMs: 5000,
  storage: "memory",
  keepFiles: 10,
  maxLogMb: 32
};

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

/** A recorder under test: its ctx, state, api, mocks and monitor. */
export type TestRecorder = {
  readonly ctx: RecorderCtx;
  readonly state: RecorderState;
  readonly api: RecorderApi;
  readonly emit: ReturnType<typeof createEmit>;
  readonly log: ReturnType<typeof createLog>;
  /** The monitor; attached unless `monitor: false` was asked. */
  readonly monitor: FakeMonitor;
  /** What the recorder added to the registry. */
  readonly added: (CommandEntry | SourceEntry)[];
};

/**
 * A typed emit mock of the recorder's own event.
 *
 * @returns The mock.
 */
export function createEmit() {
  return vi.fn<(name: "recorder:status", payload: RecorderStatusEvent) => void>();
}

/**
 * A recorder over a mock ctx, attached the way onInit and onStart attach it (the monitor found, the
 * stream subscribed), without the timer.
 *
 * @param options - What differs from the defaults.
 * @param options.config - Config overrides.
 * @param options.monitor - The monitor; `false` for a game without one.
 * @param options.store - The store to use instead of the memory store.
 * @param options.attached - False: the monitor is found but the stream is not subscribed.
 * @returns The recorder under test.
 */
export function recorder(
  options: {
    readonly config?: Partial<RecorderConfig>;
    readonly monitor?: FakeMonitor | false;
    readonly store?: LogStore;
    /** False: the monitor is found but the stream is not subscribed (onStart does it). */
    readonly attached?: boolean;
  } = {}
): TestRecorder {
  const monitor =
    options.monitor === false ? createFakeMonitor() : (options.monitor ?? createFakeMonitor());
  const state = createRecorderState();
  const added: (CommandEntry | SourceEntry)[] = [];
  const registry = {
    add: (entry: CommandEntry | SourceEntry) => added.push(entry),
    envelope: () => ({ path: "home", frame: 12, tainted: false }),
    build: readBuildInfo
  };
  const perf = { monitor: () => (options.monitor === false ? undefined : monitor) };
  const require = ((plugin: { name: string }) =>
    plugin.name === "perf" ? perf : registry) as unknown as Require;
  const emit = createEmit();
  const log = createLog();
  const ctx: RecorderCtx = { config: { ...CONFIG, ...options.config }, state, emit, log, require };
  if (options.store !== undefined) state.store = options.store;
  if (options.monitor !== false) state.monitor = monitor;
  if (options.monitor !== false && options.attached !== false) {
    state.unsubscribe = monitor.stream(line => listen(state, line));
  }
  return { ctx, state, api: createRecorderApi(ctx), emit, log, monitor, added };
}

/**
 * The lines waiting in the queue, oldest first.
 *
 * @param state - The recorder's state.
 * @returns The queued line references.
 */
export function queued(state: RecorderState): PerfLogLine[] {
  const lines: PerfLogLine[] = [];
  for (let index = 0; index < state.queueSize; index += 1) {
    const line = state.queue[(state.queueHead + index) % state.queue.length];
    if (line !== undefined) lines.push(line);
  }
  return lines;
}

/**
 * The lines of a log in a store, parsed.
 *
 * @param store - The store.
 * @param name - The log's name.
 * @returns Its lines.
 */
export async function storedLines(store: LogStore, name: string): Promise<PerfLogLine[]> {
  const blob = await store.read(name);
  const text = await blob.text();
  return text
    .split("\n")
    .filter(line => line !== "")
    .map(line => JSON.parse(line) as PerfLogLine);
}

/**
 * The kind (and the event name or mark label) of each line: a readable order check.
 *
 * @param lines - Log lines.
 * @returns "header", "event:recorder", "mark:boss", …
 */
export function kinds(lines: readonly PerfLogLine[]): string[] {
  return lines.map(line => {
    if (line.kind === "event") return `event:${line.name}`;
    if (line.kind === "mark") return `mark:${line.label}`;
    return line.kind;
  });
}

/**
 * A valid startup line (11-monitor): the page's start, measured once.
 *
 * @returns The startup line.
 */
export function startupLine(): PerfStartupLine {
  return {
    v: 1,
    kind: "startup",
    t: 1_760_454_000_500,
    build: null,
    htmlMs: 120,
    script: null,
    parseMs: null,
    evaluateMs: null,
    pixiMs: 80,
    initMs: 140,
    firstFrameMs: 610,
    longFrames: null
  };
}

/**
 * Lets pending promise callbacks run (the memory store answers at once).
 */
export async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** The headless game's player and session. */
type Tree = Record<string, never>;

/**
 * A real headless engine game, started: one rest node, no renderer, no frame loop.
 *
 * @returns The started game app and its stop.
 */
export async function startedGame(): Promise<{ app: GameLike; stop(): Promise<void> }> {
  const { defineNode, defineFlow } = defineGame<{
    player: Tree;
    session: Tree;
    assets: string;
    strings: Record<string, unknown>;
  }>();
  const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });
  const mainFlow = defineFlow("main", {
    nodes: { home },
    start: "home",
    edges: { home: { play: "home" } }
  });
  const app = createGame({
    pluginConfigs: {
      model: { playerProvider: memory(), initialPlayer: {}, initialSession: {}, seed: 1 },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow, safeNode: "home" }
    }
  });
  app.log.clearSinks();
  const headless = await createHeadless(app);
  return { app: app as unknown as GameLike, stop: () => headless.stop() };
}
