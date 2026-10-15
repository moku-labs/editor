/**
 * @file perf plugin — the read cycle (`readTick`): read the frames after the cursor into the
 * scratch, append them to the window, trim it to `windowMs`, pick up late GPU times, rebuild the
 * spike index and the scalars, then tell the watches. Runs on perf's own timer, inside the
 * monitor's agent span. Allocation-free: indexed loops and typed-array `copyWithin`.
 */
import type { FrameRing } from "./protocol";
import { primaryCause } from "./protocol";
import { notifyWatchers } from "./state";
import type { PerfConfig, PerfState } from "./types";

/**
 * One value of a column; NaN past its end (`noUncheckedIndexedAccess` reads a typed array as
 * possibly undefined).
 *
 * @param column - The column.
 * @param index - The index.
 * @returns The value, or NaN.
 * @example
 * ```ts
 * cell(Float32Array.of(16.5), 0); // 16.5
 * ```
 */
function cell(column: ArrayLike<number>, index: number): number {
  return column[index] ?? Number.NaN;
}

/** The rate of a row whose ring value is missing and that has no row before it: one 60 fps frame. */
const DEFAULT_RATE_MS = 16.67;

/** The window's "this second", ms. */
const SECOND_MS = 1000;

/**
 * The frame time of a row: the gap before it (the cap when there is no gap), or its work plus its
 * GPU time when that is longer.
 *
 * @param gapMs - The gap; NaN for none.
 * @param capMs - The cap the frame ran under.
 * @param jsMs - The game's work.
 * @param gpuMs - The GPU time; NaN when not measured.
 * @returns The frame time, ms.
 * @example
 * ```ts
 * frameMs(25.1, 16.7, 3, Number.NaN); // 25.1: a late frame is its gap
 * ```
 */
export function frameMs(gapMs: number, capMs: number, jsMs: number, gpuMs: number): number {
  let base = 0;
  if (Number.isFinite(gapMs)) base = gapMs;
  else if (Number.isFinite(capMs)) base = capMs;
  return Math.max(base, jsMs + (Number.isFinite(gpuMs) ? gpuMs : 0));
}

/**
 * Moves every window and row column `from` rows towards the start (the oldest rows go).
 *
 * @param state - perf's state.
 * @param from - The first row kept.
 */
function dropRows(state: PerfState, from: number): void {
  const { window } = state;
  const end = window.count;
  window.frame.copyWithin(0, from, end);
  window.t.copyWithin(0, from, end);
  window.ms.copyWithin(0, from, end);
  window.jsMs.copyWithin(0, from, end);
  window.gpuMs.copyWithin(0, from, end);
  window.rateMs.copyWithin(0, from, end);
  window.budgetMs.copyWithin(0, from, end);
  window.drawn.copyWithin(0, from, end);
  window.causes.copyWithin(0, from, end);
  window.cause.copyWithin(0, from, end);
  state.rowWritten.copyWithin(0, from, end);
  state.rowPartial.copyWithin(0, from, end);
  state.rowGapMs.copyWithin(0, from, end);
  state.rowPath.copyWithin(0, from, end);
  window.count = end - from;
}

/**
 * Writes scratch row `index` as window row `row`.
 *
 * @param state - perf's state.
 * @param row - The window row.
 * @param index - The scratch row.
 * @param written - The ring index k of the frame.
 */
function writeRow(state: PerfState, row: number, index: number, written: number): void {
  const { window, scratch } = state;
  const gapMs = cell(scratch.gapMs, index);
  const gpuMs = cell(scratch.gpuMs, index);
  const causes = cell(scratch.causes, index);
  const agentMs = cell(scratch.agentMs, index);
  const workMs = cell(scratch.workMs, index);
  let rateMs = cell(scratch.rateMs, index);
  if (Number.isNaN(rateMs) || rateMs <= 0)
    rateMs = row > 0 ? (window.rateMs[row - 1] ?? DEFAULT_RATE_MS) : DEFAULT_RATE_MS;
  let budgetMs = cell(scratch.budgetMs, index);
  if (Number.isNaN(budgetMs) || budgetMs <= 0) budgetMs = rateMs;
  const jsMs = Math.max(0, (workMs || 0) - (Number.isFinite(agentMs) ? agentMs : 0));

  window.frame[row] = cell(scratch.frame, index);
  window.t[row] = cell(scratch.t, index);
  window.drawn[row] = cell(scratch.drawn, index);
  window.causes[row] = causes;
  window.gpuMs[row] = gpuMs;
  window.rateMs[row] = rateMs;
  window.budgetMs[row] = budgetMs;
  window.jsMs[row] = jsMs;
  window.ms[row] = frameMs(gapMs, cell(scratch.capMs, index), jsMs, gpuMs);
  window.cause[row] = primaryCause(causes);
  state.rowWritten[row] = written;
  state.rowPartial[row] = cell(scratch.gpuPartial, index);
  state.rowGapMs[row] = gapMs;
  state.rowPath[row] = cell(scratch.path, index);
}

/**
 * Step 4: appends the copied rows, oldest first; a full window first drops its oldest quarter.
 *
 * @param state - perf's state.
 * @param copied - Rows the read copied.
 * @param base - The ring index k of the first copied frame.
 * @returns Whether a row was appended.
 */
function appendRows(state: PerfState, copied: number, base: number): boolean {
  const { window } = state;
  for (let index = 0; index < copied; index += 1) {
    if (window.count === window.capacity) dropRows(state, Math.max(1, window.capacity >> 2));
    writeRow(state, window.count, index, base + index);
    window.count += 1;
  }
  return copied > 0;
}

/**
 * Step 5: drops the rows that started more than `windowMs` before the newest one.
 *
 * @param state - perf's state.
 * @param windowMs - The window, ms.
 * @returns Whether rows were dropped.
 */
function trimRows(state: PerfState, windowMs: number): boolean {
  const { window } = state;
  if (window.count === 0) return false;
  const oldest = cell(window.t, window.count - 1) - windowMs;
  let first = 0;
  while (first < window.count && cell(window.t, first) < oldest) first += 1;
  if (first === 0) return false;
  dropRows(state, first);
  return true;
}

/**
 * Whether two column values differ, NaN equal to NaN.
 *
 * @param one - A value.
 * @param other - Another.
 * @returns Whether they differ.
 * @example
 * ```ts
 * differs(Number.NaN, Number.NaN); // false
 * ```
 */
function differs(one: number, other: number): boolean {
  return !Object.is(one, other);
}

/**
 * The ring slot that still holds the k-th committed frame, counted back from the newest slot: the
 * frame `ring.written − 1 − k` frames before the newest (engine fact 2: `k % capacity` while the
 * ring was never reset; this also holds after the engine's stop reset `newest` and kept `written`).
 * -1 once the frame left the ring or the slot holds another frame.
 *
 * @param ring - The frame ring.
 * @param written - The ring index k of the frame.
 * @param frame - The frame number the slot must hold.
 * @returns The slot, or -1.
 * @example
 * ```ts
 * slotOfFrame(ring, 9, 4812); // 9 on a ring of 1024 that committed 10 frames, when slot 9 holds 4812
 * ```
 */
export function slotOfFrame(ring: FrameRing, written: number, frame: number): number {
  const age = ring.written - 1 - written;
  if (ring.capacity === 0 || age < 0 || age >= ring.size) return -1;
  const slot = (ring.newest - age + ring.capacity) % ring.capacity;
  return ring.columns.frame[slot] === frame ? slot : -1;
}

/**
 * Step 6, one partial row: takes the late GPU time, `gpuPartial` and the causes from the ring slot,
 * but only while the slot still holds the row's frame (11:777-784).
 *
 * @param state - perf's state.
 * @param ring - The frame ring.
 * @param row - A row with `rowPartial` 1.
 * @returns Whether the row changed.
 */
function refreshRow(state: PerfState, ring: FrameRing, row: number): boolean {
  const { window } = state;
  const slot = slotOfFrame(ring, cell(state.rowWritten, row), cell(window.frame, row));
  if (slot < 0) return false;
  const { columns } = ring;

  const gpuMs = cell(columns.gpuMs, slot);
  const causes = cell(columns.causes, slot);
  const partial = cell(columns.gpuPartial, slot);
  const changed =
    differs(gpuMs, cell(window.gpuMs, row)) ||
    causes !== window.causes[row] ||
    partial !== state.rowPartial[row];
  if (!changed) return false;

  window.gpuMs[row] = gpuMs;
  window.causes[row] = causes;
  state.rowPartial[row] = partial;
  const capMs = cell(columns.capMs, slot);
  window.ms[row] = frameMs(cell(state.rowGapMs, row), capMs, cell(window.jsMs, row), gpuMs);
  window.cause[row] = primaryCause(causes);
  return true;
}

/**
 * Step 6: every partial row picks up its late GPU time from its slot.
 *
 * @param state - perf's state.
 * @param ring - The frame ring.
 * @returns Whether a row changed.
 */
function refreshPartial(state: PerfState, ring: FrameRing): boolean {
  let changed = false;
  for (let row = 0; row < state.window.count; row += 1) {
    if (state.rowPartial[row] === 1 && refreshRow(state, ring, row)) changed = true;
  }
  return changed;
}

/**
 * Step 7: the spike index, every row whose primary cause is set, oldest first.
 *
 * @param state - perf's state.
 */
function indexSpikes(state: PerfState): void {
  const { window } = state;
  let spikeCount = 0;
  for (let row = 0; row < window.count; row += 1) {
    if (window.cause[row] === 0) continue;
    window.spikes[spikeCount] = row;
    spikeCount += 1;
  }
  window.spikeCount = spikeCount;
}

/**
 * Step 8: the time axis, the GPU timer flag and the fps of the last second.
 *
 * @param state - perf's state.
 * @param windowMs - The window, ms.
 * @returns Whether a window scalar changed.
 */
function updateScalars(state: PerfState, windowMs: number): boolean {
  const { window } = state;
  const gpuTimer = state.header === undefined || state.header.gpu.timer !== null;
  const timerChanged = gpuTimer !== window.gpuTimer;
  window.gpuTimer = gpuTimer;
  if (window.count === 0) {
    state.fpsLoop = 0;
    state.fpsDrawn = 0;
    return timerChanged;
  }

  const newest = window.count - 1;
  const newestT = cell(window.t, newest);
  const endMs = newestT + cell(window.ms, newest);
  const changed = timerChanged || endMs !== window.endMs;
  window.endMs = endMs;
  window.startMs = endMs - windowMs;
  let loop = 0;
  let drawn = 0;
  for (let row = newest; row >= 0 && cell(window.t, row) > newestT - SECOND_MS; row -= 1) {
    loop += 1;
    if (window.drawn[row] === 1) drawn += 1;
  }
  state.fpsLoop = loop;
  state.fpsDrawn = drawn;
  return changed;
}

/**
 * Steps 3–10 inside the agent span: read, append, trim, late GPU, spike index, scalars; then
 * `version` and the watches when anything changed. A ring whose `written` went below the cursor was
 * rebuilt by the engine: the window starts over.
 *
 * @param state - perf's state.
 * @param ring - The frame ring.
 * @param config - perf's config.
 */
function readRing(state: PerfState, ring: FrameRing, config: Readonly<PerfConfig>): void {
  const reset = state.cursor !== undefined && ring.written < state.cursor;
  if (reset) {
    // The engine rebuilt its ring (a new capacity): start over, as at the first read of a run.
    state.cursor = undefined;
    state.window.count = 0;
  }
  const first = state.cursor === undefined;
  const since = state.cursor ?? Math.max(0, ring.written - ring.size);
  const result = ring.read(state.scratch, since);
  const { copied, lost } = result;
  if (!first) state.lost += lost;
  state.cursor = ring.written;

  const appended = appendRows(state, copied, ring.written - copied);
  const trimmed = trimRows(state, config.windowMs);
  const refreshed = refreshPartial(state, ring);
  indexSpikes(state);
  const scalars = updateScalars(state, config.windowMs);
  state.measuring = true;
  if (!(reset || appended || trimmed || refreshed || scalars)) return;

  state.window.version += 1;
  notifyWatchers(state);
}

/**
 * One read of the frame ring (perf's 4 Hz timer). No monitor: nothing. A ring of capacity 0: not
 * measuring (status `waiting`), no read. Else the read cycle runs between `beginAgent` and
 * `endAgent`, the end also when the read throws, so perf never makes the spike it measures.
 *
 * @param state - perf's state.
 * @param config - perf's config.
 */
export function readTick(state: PerfState, config: Readonly<PerfConfig>): void {
  const { monitor } = state;
  if (monitor === undefined) return;
  const ring = monitor.frames();
  if (ring.capacity === 0) {
    state.measuring = false;
    return;
  }

  monitor.beginAgent();
  try {
    readRing(state, ring, config);
  } finally {
    monitor.endAgent();
  }
}
