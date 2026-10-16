/**
 * @file renderView series — finding rows of perf's history by time and by frame (spec 09 § M8:
 * "rows older than the view are skipped by a binary search on `t`, never iterated"). Pure and
 * allocation-free: every answer is a row index.
 */
import type { PerfHistory } from "../source/contract";

/**
 * The first index of an ascending column whose value is at least `value` (`count` when none).
 *
 * @param column - The column, ascending over its first `count` cells.
 * @param count - Cells in use.
 * @param value - The value looked for.
 * @returns The index.
 */
function lowerBound(column: ArrayLike<number>, count: number, value: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((column[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The first index of an ascending column whose value is above `value` (`count` when none).
 *
 * @param column - The column, ascending over its first `count` cells.
 * @param count - Cells in use.
 * @param value - The value looked for.
 * @returns The index.
 */
function upperBound(column: ArrayLike<number>, count: number, value: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((column[middle] ?? 0) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The first row that starts at or after a time.
 *
 * @param history - The history.
 * @param t - Source-clock ms.
 * @returns The row; `history.count` when none.
 * @example
 * ```ts
 * rowFrom(history, 63_000); // the first row of a view that starts at 63 s
 * ```
 */
export function rowFrom(history: PerfHistory, t: number): number {
  return lowerBound(history.t, history.count, t);
}

/**
 * The first row still visible after a time: the row before `rowFrom` when it ends after it (a long
 * rest that began earlier).
 *
 * @param history - The history.
 * @param t - Source-clock ms of the view's start.
 * @returns The row; `history.count` when none.
 * @example
 * ```ts
 * firstVisibleRow(history, 63_000); // 4210: a 1 s rest from 62.5 s still shows
 * ```
 */
export function firstVisibleRow(history: PerfHistory, t: number): number {
  const first = rowFrom(history, t);
  if (first === 0) return 0;
  const before = first - 1;
  return (history.t[before] ?? 0) + (history.ms[before] ?? 0) > t ? before : first;
}

/**
 * The first row whose frame is at or after a frame number.
 *
 * @param history - The history.
 * @param frame - The frame.
 * @returns The row; `history.count` when none.
 * @example
 * ```ts
 * rowFromFrame(history, 4852); // 366, or the next held row when 4852 is missing
 * ```
 */
export function rowFromFrame(history: PerfHistory, frame: number): number {
  return lowerBound(history.frame, history.count, frame);
}

/**
 * The row of a frame number.
 *
 * @param history - The history.
 * @param frame - The frame.
 * @returns Its row; −1 when the history does not hold it.
 * @example
 * ```ts
 * rowOfFrame(history, 4851); // 365
 * ```
 */
export function rowOfFrame(history: PerfHistory, frame: number): number {
  const row = lowerBound(history.frame, history.count, frame);
  return row < history.count && history.frame[row] === frame ? row : -1;
}

/**
 * The newest row that starts at or before a time.
 *
 * @param history - The history.
 * @param t - Source-clock ms.
 * @returns The row; −1 when every row starts after it (or none is held).
 * @example
 * ```ts
 * rowAtTime(history, 80_310.2); // the row of the frame a rate change happened in
 * ```
 */
export function rowAtTime(history: PerfHistory, t: number): number {
  return upperBound(history.t, history.count, t) - 1;
}

/**
 * The end of the newest row: its start plus its ms.
 *
 * @param history - The history.
 * @returns Source-clock ms; undefined without rows.
 * @example
 * ```ts
 * newestEnd(history); // 69_995.3
 * ```
 */
export function newestEnd(history: PerfHistory): number | undefined {
  const last = history.count - 1;
  if (last < 0) return undefined;
  return (history.t[last] ?? 0) + (history.ms[last] ?? 0);
}
