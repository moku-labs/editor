import { createApp as createGame, defineGame, type } from "@moku-labs/game";
import { createHeadless, fakeClock, memory } from "@moku-labs/game/testing";
import { vi } from "vitest";
import type {
  FakeFrame,
  FakeMonitor,
  FakeMonitorOptions
} from "../../../../tests/fixtures/fake-monitor";
import { createFakeMonitor } from "../../../../tests/fixtures/fake-monitor";
import type { Require } from "../../../config";
import type { Json, RunState } from "../../registry/protocol";
import type { CommandEntry, GameLike, SourceEntry } from "../../registry/types";
import { addPerfEntries } from "../entries";
import type { PerfWindow } from "../protocol";
import { createPerfWindow, primaryCause } from "../protocol";
import { readTick } from "../reader";
import { createPerfState } from "../state";
import { listen } from "../stream";
import type { PerfConfig, PerfCtx, PerfState } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of perf's unit tests: a state with a fake monitor attached, frame
// commits, a mock log and ctx, and a real headless engine game for the app tests.
// ─────────────────────────────────────────────────────────────────────────────

/** perf's defaults. */
export const CONFIG: PerfConfig = {
  readEveryMs: 250,
  windowMs: 6000,
  frames: 1024,
  feedPasses: false,
  feedSystems: true,
  feedNodes: false
};

/** The run state a fake registry's `envelope` answers. */
export const ENVELOPE: RunState = { path: "home", frame: 1, tainted: false };

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

/** A state and the config it was made from. */
export type TestPerf = { readonly state: PerfState; readonly config: PerfConfig };

/**
 * Makes perf's state from the defaults plus overrides.
 *
 * @param overrides - Config fields to replace.
 * @returns The state and config.
 */
export function perfState(overrides: Partial<PerfConfig> = {}): TestPerf {
  const config = { ...CONFIG, ...overrides };
  return { state: createPerfState({ config }), config };
}

/**
 * Attaches a fake monitor to a state the way onInit and onStart do: the monitor, a game whose
 * renderer has it (and `stats` when given), and the stream listener.
 *
 * @param state - perf's state.
 * @param monitor - The fake monitor.
 * @param stats - The renderer's `stats` function, when the game has one.
 * @returns The unsubscribe of the stream.
 */
export function attach(state: PerfState, monitor: FakeMonitor, stats?: () => unknown): () => void {
  const renderer = stats === undefined ? { monitor } : { monitor, stats };
  state.game = { renderer } as unknown as GameLike;
  state.monitor = monitor;
  state.off = undefined;
  const off = monitor.stream(line => listen(state, line));
  state.unsubscribe = off;
  return off;
}

/**
 * Commits `count` frames `step` ms apart from `t0`, each with the given values.
 *
 * @param monitor - The fake monitor.
 * @param count - Frames.
 * @param t0 - Page-clock ms of the first.
 * @param step - ms between frame starts.
 * @param frame - Values of every frame.
 * @returns The frame numbers.
 */
export function commitFrames(
  monitor: FakeMonitor,
  count: number,
  t0: number,
  step: number,
  frame: Omit<FakeFrame, "t"> = {}
): number[] {
  const frames: number[] = [];
  for (let index = 0; index < count; index += 1) {
    frames.push(monitor.commit({ gapMs: step, ...frame, t: t0 + index * step }));
  }
  return frames;
}

/**
 * A perf ctx over a state, with a mock log and a `require` that answers the given registry.
 *
 * @param perf - The state and config.
 * @param registry - What `require(registryPlugin)` answers.
 * @returns The ctx and its log.
 */
export function perfCtx(perf: TestPerf, registry: object = {}) {
  const log = createLog();
  const require = (() => registry) as unknown as Require;
  const ctx: PerfCtx = { config: perf.config, state: perf.state, log, require };
  return { ctx, log };
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

/** One row of a hand-made window. */
export type WindowRow = {
  readonly frame?: number;
  readonly t: number;
  readonly ms?: number;
  readonly jsMs?: number;
  readonly gpuMs?: number;
  readonly rateMs?: number;
  readonly budgetMs?: number;
  readonly drawn?: 0 | 1;
  readonly causes?: number;
  /** Cause bits heard but not counted (the gpu bit of a lone GPU outlier); 0 by default. */
  readonly noise?: number;
  /** The row's `REST` state; awake by default. */
  readonly rest?: number;
  /** A primary cause code to force (default: from `causes`). */
  readonly cause?: number;
};

/**
 * A window of hand-made rows (frame numbers from 1 by default), its spike index built from the
 * cause codes, the axis from the first row to the end of the last.
 *
 * @param rows - The rows, oldest first.
 * @param options - The axis span and the GPU timer.
 * @param options.spanMs - The time axis length, ms.
 * @param options.gpuTimer - Whether the page has a GPU timer.
 * @returns The window.
 */
export function windowOf(
  rows: readonly WindowRow[],
  options: { readonly spanMs?: number; readonly gpuTimer?: boolean } = {}
): PerfWindow {
  const window = createPerfWindow(Math.max(1, rows.length));
  for (const [index, row] of rows.entries()) {
    const cause = row.cause ?? primaryCause(row.causes ?? 0);
    window.frame[index] = row.frame ?? index + 1;
    window.t[index] = row.t;
    window.ms[index] = row.ms ?? 16.7;
    window.jsMs[index] = row.jsMs ?? 3;
    window.gpuMs[index] = row.gpuMs ?? Number.NaN;
    window.rateMs[index] = row.rateMs ?? 16.67;
    window.budgetMs[index] = row.budgetMs ?? 16.67;
    window.drawn[index] = row.drawn ?? 1;
    window.causes[index] = row.causes ?? 0;
    window.noise[index] = row.noise ?? 0;
    window.rest[index] = row.rest ?? 0;
    window.cause[index] = cause;
    if (cause !== 0) {
      window.spikes[window.spikeCount] = index;
      window.spikeCount += 1;
    }
  }
  window.count = rows.length;
  const last = rows.at(-1);
  window.endMs = (last?.t ?? 0) + (last?.ms ?? 16.7);
  window.startMs = window.endMs - (options.spanMs ?? 6000);
  window.gpuTimer = options.gpuTimer ?? true;
  return window;
}

/** The entries perf added to a fake registry, by id. */
export type TestEntries = {
  /** The source of an id; throws for an unknown one. */
  source(id: string): SourceEntry;
  /** Reads a source of an id. */
  read(id: string, input?: Json): Json;
  /** The command of an id; throws for an unknown one. */
  command(id: string): CommandEntry;
  /** Every id, in the order perf added them. */
  readonly ids: string[];
};

/**
 * Adds perf's entries to a fake registry (`add` and `envelope`) and answers them by id.
 *
 * @param perf - The state and config.
 * @returns The entries.
 */
export function entriesOf(perf: TestPerf): TestEntries {
  const sources = new Map<string, SourceEntry>();
  const commands = new Map<string, CommandEntry>();
  const ids: string[] = [];
  addPerfEntries(
    {
      add: entry => {
        ids.push(entry.descriptor.id);
        if ("read" in entry) sources.set(entry.descriptor.id, entry);
        else commands.set(entry.descriptor.id, entry);
      },
      envelope: () => ENVELOPE
    },
    perf.state,
    perf.config
  );
  const source = (id: string): SourceEntry => {
    const found = sources.get(id);
    if (found === undefined) throw new Error(`no source ${id}`);
    return found;
  };
  const command = (id: string): CommandEntry => {
    const found = commands.get(id);
    if (found === undefined) throw new Error(`no command ${id}`);
    return found;
  };
  // eslint-disable-next-line unicorn/no-null -- null is "no input" on the wire
  return { source, read: (id, input = null) => source(id).read(input), command, ids };
}

/**
 * perf on a fake monitor with its entries in a fake registry: the rig of the Mission control feed
 * tests.
 *
 * @param config - Config fields to replace.
 * @param options - The fake monitor's options (capacity 256 by default).
 * @returns The perf, the monitor, its entries and a tick.
 */
export function feedRig(config: Partial<PerfConfig> = {}, options: FakeMonitorOptions = {}) {
  const perf = perfState(config);
  const monitor = createFakeMonitor({ capacity: 256, ...options });
  attach(perf.state, monitor);
  const entries = entriesOf(perf);
  return { ...perf, ...entries, monitor, tick: () => readTick(perf.state, perf.config) };
}
