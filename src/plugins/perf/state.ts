/**
 * @file perf plugin — the config check and the state: every array is allocated here, once, and the
 * notify of the source watches.
 */
import type { PerfEventLine, PerfPassesLine, PerfSpikeLine } from "./protocol";
import {
  capsOf,
  createPerfWindow,
  PASS_ROWS_PER_FRAME,
  SYSTEMS_PER_FRAME,
  TIMELINE_SLOTS
} from "./protocol";
import type {
  PassWindow,
  PerfConfig,
  PerfReadout,
  PerfScratch,
  PerfState,
  TimelineLine
} from "./types";

/** Spike lines kept, newest last. */
const SPIKE_LINES = 64;

/** `rate` event lines kept. */
const RATE_LINES = 16;

/** Frame-event lines of the game kept (`overlay`, `pool-trim`, `warm`). */
const FRAME_EVENTS = 32;

/**
 * The range of each config field and the words of its error: checked in this order, and the message
 * names the same numbers the check uses.
 */
const RANGES = [
  {
    key: "readEveryMs",
    low: 50,
    high: 1000,
    whole: false,
    what: "milliseconds",
    note: "; 250 reads four times a second"
  },
  {
    key: "windowMs",
    low: 1000,
    high: 30_000,
    whole: false,
    what: "milliseconds",
    note: "; the graph shows 6000"
  },
  {
    key: "frames",
    low: 64,
    high: 16_384,
    whole: true,
    what: "a whole number",
    note: ", at least the frames of windowMs at 120 Hz"
  }
] as const satisfies readonly {
  readonly key: keyof PerfConfig;
  readonly low: number;
  readonly high: number;
  readonly whole: boolean;
  readonly what: string;
  readonly note: string;
}[];

/** The feed switches of the config and the word each one's error names. */
const FEEDS = [
  ["feedPasses", "passes"],
  ["feedSystems", "systems"],
  ["feedNodes", "nodes"]
] as const;

/**
 * Whether a config value is in its range: a finite number from `low` to `high`, whole when asked.
 *
 * @param value - The value.
 * @param range - Its range.
 * @param range.low - The smallest allowed.
 * @param range.high - The largest allowed.
 * @param range.whole - Whether only a whole number is allowed.
 * @returns Whether it is allowed.
 * @example
 * ```ts
 * inRange(250, { low: 50, high: 1000, whole: false }); // true
 * ```
 */
function inRange(
  value: number,
  range: { readonly low: number; readonly high: number; readonly whole: boolean }
): boolean {
  const finite = typeof value === "number" && Number.isFinite(value);
  return (
    finite && value >= range.low && value <= range.high && (!range.whole || Number.isInteger(value))
  );
}

/**
 * Checks perf's config: `readEveryMs` 50 to 1000, `windowMs` 1000 to 30000, `frames` a whole number
 * from 64 to 16384, and the three feed switches booleans. It runs when the state is made, so no
 * array is ever sized from a bad value.
 *
 * @param config - The resolved config.
 * @throws {TypeError} `[moku-editor] perf.<field> is <value>.` with how to fix it.
 */
export function checkPerfConfig(config: Readonly<PerfConfig>): void {
  for (const range of RANGES) {
    const value = config[range.key];
    if (inRange(value, range)) continue;
    throw new TypeError(
      `[moku-editor] perf.${range.key} is ${String(value)}.\n  Give ${range.what} from ${String(range.low)} to ${String(range.high)}${range.note}.`
    );
  }
  for (const [key, what] of FEEDS) {
    const value: unknown = config[key];
    if (typeof value === "boolean") continue;
    throw new TypeError(
      `[moku-editor] perf.${key} is ${String(value)}.\n  Give true or false; false reads no ${what}.`
    );
  }
}

/**
 * Allocates the read target of a tick: the ring columns perf copies, `frames` long (the systems
 * five a frame); `budgetMs` starts as NaN, so a ring without that column leaves it NaN.
 *
 * @param frames - The rows.
 * @returns The scratch columns.
 */
function createScratch(frames: number): PerfScratch {
  return {
    length: frames,
    frame: new Uint32Array(frames),
    t: new Float64Array(frames),
    gapMs: new Float32Array(frames),
    capMs: new Float32Array(frames),
    rateMs: new Float32Array(frames),
    budgetMs: new Float32Array(frames).fill(Number.NaN),
    workMs: new Float32Array(frames),
    agentMs: new Float32Array(frames),
    gpuMs: new Float32Array(frames),
    gpuPartial: new Uint8Array(frames),
    drawn: new Uint8Array(frames),
    idle: new Uint8Array(frames),
    reason: new Uint8Array(frames),
    causes: new Uint8Array(frames),
    path: new Uint16Array(frames),
    draws: new Float32Array(frames),
    sysIdx: new Uint16Array(frames * SYSTEMS_PER_FRAME),
    sysMs: new Float32Array(frames * SYSTEMS_PER_FRAME),
    marks: new Float32Array(frames)
  };
}

/**
 * The four read targets over one scratch: the base columns, plus the systems (1), the marks (2) or
 * both (3), so a read copies a feed's columns only while it is on.
 *
 * @param scratch - The scratch.
 * @returns The read targets by mask.
 */
function createReadouts(scratch: PerfScratch): PerfState["readouts"] {
  const { sysIdx, sysMs, marks, ...base } = scratch;
  const plain: PerfReadout = base;
  return [plain, { ...base, sysIdx, sysMs }, { ...base, marks }, scratch];
}

/**
 * Allocates the pass window of `frames × 4` rows; the 0.15.x columns come later, once the ring has
 * them.
 *
 * @param frames - The window's rows.
 * @returns The empty pass window.
 */
function createPassWindow(frames: number): PassWindow {
  const capacity = frames * PASS_ROWS_PER_FRAME;
  return {
    capacity,
    count: 0,
    seq: new Float64Array(capacity),
    frame: new Uint32Array(capacity),
    index: new Uint8Array(capacity),
    kind: new Uint8Array(capacity),
    w: new Uint16Array(capacity),
    h: new Uint16Array(capacity),
    gpuMs: new Float32Array(capacity),
    // eslint-disable-next-line unicorn/no-null -- null is "no label", as in the engine's ring
    label: Array.from<string | null>({ length: capacity }).fill(null),
    owner: undefined,
    filter: undefined,
    drawsAt: undefined,
    format: undefined,
    resolution: undefined
  };
}

/**
 * Creates perf's state: checks the config, then allocates the window, the row arrays, the scratch
 * and its read targets of `config.frames`, the pass window, and the kept-line slots (64 spike, 16
 * rate, 32 frame-event, 256 timeline, 2 `passes` lines). No other allocation happens while perf
 * runs except the documented ones (API copies, wire values, `second()`, the capabilities once per
 * header, the pass window's 0.15.x columns once, the system names when they grow).
 *
 * @param ctx - The minimal context.
 * @param ctx.config - The resolved config.
 * @returns The state.
 * @throws {TypeError} For a config value out of range (`checkPerfConfig`).
 */
export function createPerfState(ctx: { readonly config: Readonly<PerfConfig> }): PerfState {
  const { config } = ctx;
  checkPerfConfig(config);
  const { frames } = config;
  const scratch = createScratch(frames);
  const state: PerfState = {
    game: undefined,
    monitor: undefined,
    off: undefined,
    measuring: false,
    window: createPerfWindow(frames),
    rowWritten: new Float64Array(frames),
    rowPartial: new Uint8Array(frames),
    rowGapMs: new Float32Array(frames),
    rowPath: new Uint16Array(frames),
    scratch,
    idleSinceT: undefined,
    awakeP90Ms: Number.NaN,
    cursor: undefined,
    lost: 0,
    fpsLoop: 0,
    fpsDrawn: 0,
    header: undefined,
    display: undefined,
    sample: undefined,
    // eslint-disable-next-line unicorn/no-null -- null is "the engine has not learned the display's rate"
    displayHz: null,
    spikeLines: Array.from<PerfSpikeLine | undefined>({ length: SPIKE_LINES }),
    spikeLineNext: 0,
    rateLines: Array.from<PerfEventLine | undefined>({ length: RATE_LINES }),
    rateLineNext: 0,
    frameEvents: Array.from<PerfEventLine | undefined>({ length: FRAME_EVENTS }),
    frameEventNext: 0,
    timer: undefined,
    unsubscribe: undefined,
    watchers: new Set(),
    callWatcher: watcher => callIsolated(state, watcher),
    log: undefined,
    watchFailed: false,
    watchStreak: false,
    second: undefined,
    readouts: createReadouts(scratch),
    readMask: 0,
    rowDraws: new Float32Array(frames),
    rowSysIdx: new Int16Array(frames * SYSTEMS_PER_FRAME),
    rowSysMs: new Float32Array(frames * SYSTEMS_PER_FRAME),
    rowMarks: new Float32Array(frames),
    // Nothing measured before the first read: no ring, no header, a monitor without the next change.
    caps: capsOf(undefined, undefined, {}),
    capsStale: true,
    feeds: { passes: config.feedPasses, systems: config.feedSystems, nodes: config.feedNodes },
    sections: undefined,
    // eslint-disable-next-line unicorn/no-null -- null is "the engine has not said"
    overdraw: null,
    passes: createPassWindow(frames),
    passCursor: undefined,
    passesLost: 0,
    timeline: Array.from<TimelineLine | undefined>({ length: TIMELINE_SLOTS }),
    timelineSeq: 0,
    // eslint-disable-next-line unicorn/no-null -- null is "no display rate kept yet"
    timelineHz: null,
    shaderSeen: false,
    passesLines: Array.from<PerfPassesLine | undefined>({ length: 2 }),
    passesLineNext: 0,
    // eslint-disable-next-line unicorn/no-null -- null is "no sample yet"
    heapLast: null,
    heapSame: 0,
    editorMs: Number.NaN,
    systemNames: [],
    namesRef: undefined,
    namesLength: 0
  };
  return state;
}

/**
 * Calls one watcher of a state, isolated: a throw is caught, so the other watchers and the read
 * that notified them go on; the first throw of a streak of failing rounds warns
 * `perf:watcher-failed`.
 *
 * @param state - perf's state.
 * @param watcher - The watcher.
 */
function callIsolated(state: PerfState, watcher: () => void): void {
  try {
    watcher();
  } catch (error) {
    state.watchFailed = true;
    if (state.watchStreak) return;
    state.watchStreak = true;
    state.log?.warn("perf:watcher-failed", { error });
  }
}

/**
 * Drops the cached `second()` and calls every source watch, each isolated (a throw of one never
 * reaches the others or the caller). A round without a failure ends the streak of warnings.
 * Allocates nothing.
 *
 * @param state - perf's state.
 */
export function notifyWatchers(state: PerfState): void {
  state.second = undefined;
  state.watchFailed = false;
  // Set#forEach allocates no iterator: the read cycle stays allocation-free (spec 03).
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- see above
  state.watchers.forEach(state.callWatcher);
  if (!state.watchFailed) state.watchStreak = false;
}

/**
 * Tells the watches inside the monitor's agent span (spec 03 step 10: a watch delivery is agent
 * work), the span closed also when the delivery throws.
 *
 * @param state - perf's state.
 */
export function notifyInSpan(state: PerfState): void {
  const { monitor } = state;
  monitor?.beginAgent();
  try {
    notifyWatchers(state);
  } finally {
    monitor?.endAgent();
  }
}
