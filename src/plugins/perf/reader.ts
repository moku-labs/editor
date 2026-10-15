/**
 * @file perf plugin — the read cycle (`readTick`): read the frames after the cursor into the
 * scratch, append them to the window, trim it to `windowMs`, pick up late GPU times, count the
 * sustained GPU (2 of 3 drawn frames), rebuild the spike index, the headline GPU and the scalars,
 * then tell the watches. Runs on perf's own timer, inside the monitor's agent span. Allocation-free:
 * indexed loops, typed-array `copyWithin` and an in-place sort.
 */
import type { FrameRing, PerfWindow, RestState } from "./protocol";
import {
  announcedHzOf,
  DEFAULT_RATE_MS,
  displayHzOf,
  GAP_BIT,
  GPU_BIT,
  hasWork,
  isNotableGap,
  promoteSustainedGpu,
  REST,
  spikeCause,
  spreadGpu
} from "./protocol";
import { REASON_NONE, ringCauses } from "./ring";
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

/** A gap this long or longer without work is a break: the browser made no frame, ms. */
const BREAK_GAP_MS = 900;

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
  window.rest.copyWithin(0, from, end);
  window.causes.copyWithin(0, from, end);
  window.noise.copyWithin(0, from, end);
  window.cause.copyWithin(0, from, end);
  state.rowWritten.copyWithin(0, from, end);
  state.rowPartial.copyWithin(0, from, end);
  state.rowGapMs.copyWithin(0, from, end);
  state.rowPath.copyWithin(0, from, end);
  window.count = end - from;
}

/**
 * The rest of scratch row `index` as window row `row` (spec 03 delta 2026-10-15): resting when the
 * engine ran it under its idle cap or rendered it on demand and drew nothing; a break when a gap of
 * 900 ms or more came without work (the browser made no frame); the wake when the row before rested;
 * else awake.
 *
 * @param state - perf's state.
 * @param row - The window row it becomes.
 * @param index - The scratch row.
 * @returns The rest state.
 */
function restOf(state: PerfState, row: number, index: number): RestState {
  const { scratch, window } = state;
  const isIdleCap = scratch.idle[index] === 1;
  const isStillDemand = scratch.drawn[index] === 0 && scratch.reason[index] === REASON_NONE;
  if (isIdleCap || isStillDemand) return REST.idle;
  const isBreak =
    cell(scratch.gapMs, index) >= BREAK_GAP_MS && !hasWork(ringCauses(cell(scratch.causes, index)));
  if (isBreak) return REST.break;
  return row > 0 && window.rest[row - 1] === REST.idle ? REST.woke : REST.awake;
}

/**
 * The cause bits perf keeps for a row: the engine's, with the gap bit of a gap vsync explains cleared
 * (one frame of the budget or of the display, whichever is longer, times 1.5).
 *
 * @param causes - The engine's cause bits.
 * @param gapMs - The gap before the frame.
 * @param budgetMs - The frame's budget.
 * @param displayHz - The display's rate the engine learned; null when unknown.
 * @returns The bits kept.
 * @example
 * ```ts
 * keptCauses(0b1, 16.7, 8.33, 60); // 0: one vsync of a 60 Hz display
 * ```
 */
function keptCauses(
  causes: number,
  gapMs: number,
  budgetMs: number,
  displayHz: number | null
): number {
  if ((causes & GAP_BIT) === 0 || isNotableGap(gapMs, budgetMs, displayHz)) return causes;
  return causes & ~GAP_BIT;
}

/**
 * Writes a row's cause bits as perf heard them (`keptCauses`): a GPU over budget waits in `noise`
 * until `promoteSustainedGpu` counts it, and a GPU once counted stays counted; then the cause.
 *
 * @param window - The window; the row's `rest` is written.
 * @param row - The row.
 * @param heard - The bits kept from the engine's.
 * @param counted - `GPU_BIT` when the row's GPU was counted already, else 0.
 * @returns Whether `causes` or `noise` changed.
 */
function writeCauses(window: PerfWindow, row: number, heard: number, counted: number): boolean {
  const causes = (heard & ~GPU_BIT) | (heard & counted);
  const noise = heard & GPU_BIT & ~counted;
  const changed = causes !== window.causes[row] || noise !== window.noise[row];
  window.causes[row] = causes;
  window.noise[row] = noise;
  window.cause[row] = spikeCause(causes, cell(window.rest, row));
  return changed;
}

/**
 * The rate of scratch row `index`: the ring's, else the row before's, else one 60 fps frame.
 *
 * @param state - perf's state.
 * @param row - The window row it becomes.
 * @param index - The scratch row.
 * @returns One frame of the rate, ms.
 */
function rowRateMs(state: PerfState, row: number, index: number): number {
  const rateMs = cell(state.scratch.rateMs, index);
  if (rateMs > 0) return rateMs;
  return row > 0 ? (state.window.rateMs[row - 1] ?? DEFAULT_RATE_MS) : DEFAULT_RATE_MS;
}

/**
 * The budget of scratch row `index`: the ring's, else its rate; a resting frame's is at least its
 * cap (the idle cap's frame).
 *
 * @param state - perf's state.
 * @param index - The scratch row.
 * @param rateMs - Its rate.
 * @param rest - Its rest.
 * @returns The budget, ms.
 */
function rowBudgetMs(state: PerfState, index: number, rateMs: number, rest: RestState): number {
  const budgetMs = cell(state.scratch.budgetMs, index);
  const own = budgetMs > 0 ? budgetMs : rateMs;
  const capMs = cell(state.scratch.capMs, index);
  return rest === REST.idle && capMs > own ? capMs : own;
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
  const agentMs = cell(scratch.agentMs, index);
  const rateMs = rowRateMs(state, row, index);
  const rest = restOf(state, row, index);
  const budgetMs = rowBudgetMs(state, index, rateMs, rest);
  const heard = keptCauses(
    ringCauses(cell(scratch.causes, index)),
    gapMs,
    budgetMs,
    state.displayHz
  );
  const jsMs = Math.max(
    0,
    (cell(scratch.workMs, index) || 0) - (Number.isFinite(agentMs) ? agentMs : 0)
  );

  window.frame[row] = cell(scratch.frame, index);
  window.t[row] = cell(scratch.t, index);
  window.drawn[row] = cell(scratch.drawn, index);
  window.rest[row] = rest;
  writeCauses(window, row, heard, 0);
  window.gpuMs[row] = gpuMs;
  window.rateMs[row] = rateMs;
  window.budgetMs[row] = budgetMs;
  window.jsMs[row] = jsMs;
  window.ms[row] = frameMs(gapMs, cell(scratch.capMs, index), jsMs, gpuMs);
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
 * but only while the slot still holds the row's frame (11:777-784). A GPU over budget that lands
 * waits in `noise` for `promoteSustainedGpu`.
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
  const gapMs = cell(state.rowGapMs, row);
  const heard = keptCauses(
    ringCauses(cell(columns.causes, slot)),
    gapMs,
    cell(window.budgetMs, row),
    state.displayHz
  );
  const partial = cell(columns.gpuPartial, slot);
  const causesChanged = writeCauses(window, row, heard, cell(window.causes, row) & GPU_BIT);
  const changed =
    causesChanged || differs(gpuMs, cell(window.gpuMs, row)) || partial !== state.rowPartial[row];
  if (!changed) return false;

  window.gpuMs[row] = gpuMs;
  state.rowPartial[row] = partial;
  const capMs = cell(columns.capMs, slot);
  window.ms[row] = frameMs(gapMs, capMs, cell(window.jsMs, row), gpuMs);
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
    const rest = window.rest[row];
    if (rest === REST.idle || rest === REST.break) continue;
    loop += 1;
    if (window.drawn[row] === 1) drawn += 1;
  }
  state.fpsLoop = loop;
  state.fpsDrawn = drawn;
  return changed;
}

/**
 * Steps 3–10 inside the agent span: read, append, trim, late GPU, the sustained GPU, spike index,
 * headline GPU, scalars; then `version` and the watches when anything changed. A ring whose
 * `written` went below the cursor was rebuilt by the engine: the window starts over.
 *
 * @param state - perf's state.
 * @param ring - The frame ring.
 * @param config - perf's config.
 */
function readRing(state: PerfState, ring: FrameRing, config: Readonly<PerfConfig>): void {
  // The display's rate, for the vsync judgement of the gaps read now: the hz the display announces,
  // else the one the engine's time learned.
  state.displayHz = announcedHzOf(state.display) ?? displayHzOf(state.game) ?? state.displayHz;

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
  const promoted = promoteSustainedGpu(state.window);
  const rowsChanged = reset || appended || trimmed || refreshed || promoted;
  if (rowsChanged) spreadGpu(state.window, state.gpuSorted);
  indexSpikes(state);
  const scalars = updateScalars(state, config.windowMs);
  state.measuring = true;
  if (!(rowsChanged || scalars)) return;

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
