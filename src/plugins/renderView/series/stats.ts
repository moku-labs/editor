/**
 * @file renderView series — the frames header numbers of the view (spec 09 § M8, MissionView.stats)
 * over the history's rows: spikes as groups, the worst spike, p90 of the awake frames, rest time
 * clipped to the view, GCs in view. Percentiles over one preallocated scratch.
 */
import type { PerfHistory } from "../source/contract";
import { HISTORY_ROWS, nearestRank, REST, sortHead } from "../source/contract";
import type { MissionView } from "../types";
import { spikeGroups } from "./groups";
import { firstVisibleRow, rowFrom } from "./rows";

/** The ms of the awake frames of a view, sorted for the p90: one array for every call. */
const SCRATCH = new Float64Array(HISTORY_ROWS);

/**
 * A number rounded to tenths.
 *
 * @param value - The number.
 * @returns The rounded number.
 */
function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The p90 of the awake frames (awake, or the wake after a rest) of rows `first`..`end`.
 *
 * @param history - The history.
 * @param first - The first row.
 * @param end - The row after the last.
 * @returns The p90 ms; null without an awake frame.
 */
function awakeP90(history: PerfHistory, first: number, end: number): number | null {
  const p90 = percentileOf(history, history.ms, { first, end, awake: true }, 0.9);
  // eslint-disable-next-line unicorn/no-null -- null: no awake frame, the header shows no p90
  return p90 === null ? null : tenths(p90);
}

/**
 * A percentile of a column over rows `first`..`end` (nearest rank): the awake rows only when asked,
 * NaN values left out.
 *
 * @param history - The history.
 * @param column - A column of the history (`ms`, `gpuMs`, `draws`).
 * @param rows - The rows: first, the row after the last, and whether only awake rows count.
 * @param rows.first - The first row.
 * @param rows.end - The row after the last.
 * @param rows.awake - Count awake rows (and wakes) only.
 * @param fraction - The percentile, 0..1.
 * @returns The value; null without one.
 * @example
 * ```ts
 * percentileOf(history, history.gpuMs, { first: 0, end: history.count, awake: true }, 0.5); // 8.1
 * ```
 */
export function percentileOf(
  history: PerfHistory,
  column: Float32Array,
  rows: { readonly first: number; readonly end: number; readonly awake: boolean },
  fraction: number
): number | null {
  let count = 0;
  for (let row = rows.first; row < rows.end; row += 1) {
    const rest = history.rest[row] ?? REST.awake;
    if (rows.awake && rest !== REST.awake && rest !== REST.woke) continue;
    const value = column[row] ?? Number.NaN;
    if (Number.isNaN(value)) continue;
    SCRATCH[count] = value;
    count += 1;
  }
  sortHead(SCRATCH, count);
  // The lowest rank is 1: a fraction of 0 asks for the smallest value.
  // eslint-disable-next-line unicorn/no-null -- null: no value in the rows
  return count === 0 ? null : nearestRank(SCRATCH, count, Math.max(fraction, 1 / count));
}

/**
 * The resting time of rows `first`..`end`, each rest clipped to the view.
 *
 * @param history - The history.
 * @param first - The first row.
 * @param end - The row after the last.
 * @param startMs - The view's start.
 * @param endMs - The view's end.
 * @returns ms.
 */
function restIn(
  history: PerfHistory,
  first: number,
  end: number,
  startMs: number,
  endMs: number
): number {
  let total = 0;
  for (let row = first; row < end; row += 1) {
    if (history.rest[row] !== REST.idle) continue;
    const t = history.t[row] ?? 0;
    total += Math.max(0, Math.min(endMs, t + (history.ms[row] ?? 0)) - Math.max(startMs, t));
  }
  return tenths(total);
}

/**
 * The GC events whose time lies in the view.
 *
 * @param history - The history.
 * @param startMs - The view's start.
 * @param endMs - The view's end.
 * @returns The count.
 */
function gcsIn(history: PerfHistory, startMs: number, endMs: number): number {
  let count = 0;
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind === "gc" && event.t >= startMs && event.t <= endMs) count += 1;
  }
  return count;
}

/**
 * The frames header numbers of the frames inside the view: frames, spike groups, the worst spike
 * (null without one), the p90 of the awake frames (null without one), the rest clipped to the view
 * and the GCs in it. The caller shows the GCs only while memory is measured.
 *
 * @param history - The history.
 * @param startMs - The view's start, source clock.
 * @param endMs - The view's end, source clock.
 * @returns The numbers.
 * @example
 * ```ts
 * viewStats(history, 74_000, 80_000); // { frames: 720, spikes: 3, worstMs: 41.3, p90Ms: 17.6, restMs: 0, gcs: 2 }
 * ```
 */
export function viewStats(
  history: PerfHistory,
  startMs: number,
  endMs: number
): MissionView["stats"] {
  const first = firstVisibleRow(history, startMs);
  const end = rowFrom(history, endMs);
  const groups = spikeGroups(history, first, end - 1);
  let worst = Number.NEGATIVE_INFINITY;
  for (const group of groups) worst = Math.max(worst, group.maxMs);
  return {
    frames: Math.max(0, end - first),
    spikes: groups.length,
    // eslint-disable-next-line unicorn/no-null -- null: no spike in view, the header omits "worst"
    worstMs: groups.length === 0 ? null : worst,
    p90Ms: awakeP90(history, first, end),
    restMs: restIn(history, first, end, startMs, endMs),
    gcs: gcsIn(history, startMs, endMs)
  };
}
