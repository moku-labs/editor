/**
 * @file perf plugin — the config check and the state: every array is allocated here, once.
 */
import type { PerfEventLine, PerfSpikeLine } from "./protocol";
import { createPerfWindow } from "./protocol";
import type { PerfConfig, PerfScratch, PerfState } from "./types";

/** Spike lines kept, newest last. */
const SPIKE_LINES = 64;

/** `rate` event lines kept. */
const RATE_LINES = 16;

/** Frame-event lines of the game kept (`overlay`, `pool-trim`, `warm`). */
const FRAME_EVENTS = 32;

/**
 * Whether a config value is a finite number in a range.
 *
 * @param value - The value.
 * @param low - The smallest allowed.
 * @param high - The largest allowed.
 * @returns Whether it is in range.
 * @example
 * ```ts
 * inRange(250, 50, 1000); // true
 * ```
 */
function inRange(value: number, low: number, high: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;
}

/**
 * Checks perf's config: `readEveryMs` 50 to 1000, `windowMs` 1000 to 30000, `frames` a whole number
 * from 64 to 16384. It runs when the state is made, so no array is ever sized from a bad value.
 *
 * @param config - The resolved config.
 * @throws {TypeError} `[moku-editor] perf.<field> is <value>.` with how to fix it.
 */
export function checkPerfConfig(config: Readonly<PerfConfig>): void {
  const { readEveryMs, windowMs, frames } = config;
  if (!inRange(readEveryMs, 50, 1000)) {
    throw new TypeError(
      `[moku-editor] perf.readEveryMs is ${String(readEveryMs)}.\n  Give milliseconds from 50 to 1000; 250 reads four times a second.`
    );
  }
  if (!inRange(windowMs, 1000, 30_000)) {
    throw new TypeError(
      `[moku-editor] perf.windowMs is ${String(windowMs)}.\n  Give milliseconds from 1000 to 30000; the graph shows 6000.`
    );
  }
  if (!inRange(frames, 64, 16_384) || !Number.isInteger(frames)) {
    throw new TypeError(
      `[moku-editor] perf.frames is ${String(frames)}.\n  Give a whole number from 64 to 16384, at least the frames of windowMs at 120 Hz.`
    );
  }
}

/**
 * Allocates the read target of a tick: the ring columns perf copies, `frames` long; `budgetMs`
 * starts as NaN, so a ring without that column leaves it NaN.
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
    causes: new Uint8Array(frames),
    path: new Uint16Array(frames)
  };
}

/**
 * Creates perf's state: checks the config, then allocates the window, the row arrays and the
 * scratch of `config.frames`, and the kept-line slots (64 spike, 16 rate, 32 frame-event lines).
 * No other allocation happens while perf runs except the documented ones (API copies, wire values,
 * `second()`).
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
    scratch: createScratch(frames),
    cursor: undefined,
    lost: 0,
    fpsLoop: 0,
    fpsDrawn: 0,
    header: undefined,
    display: undefined,
    sample: undefined,
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
    second: undefined
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
