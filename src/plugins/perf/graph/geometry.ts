/**
 * @file perf/graph — the time axis of the last paint: the x of a page-clock time and the left, right
 * and centre of a row's bar. Shared by the painter and the hit tests; no allocation.
 */
import type { PerfWindowView } from "../protocol";
import type { GraphState } from "./types";

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
export function cell(column: ArrayLike<number>, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * The x of a page-clock time in the plot of the last paint.
 *
 * @param state - The painter state holding the layout.
 * @param t - Page-clock ms.
 * @returns The x, CSS px.
 * @example
 * ```ts
 * xOf({ px0: 1, px1: 237, startMs: 0, spanMs: 6000 }, 3000); // 119
 * ```
 */
export function xOf(
  state: Pick<GraphState, "px0" | "px1" | "startMs" | "spanMs">,
  t: number
): number {
  return state.px0 + ((t - state.startMs) / state.spanMs) * (state.px1 - state.px0);
}

/**
 * The left x of a row's bar: the start of its frame.
 *
 * @param state - The painter state.
 * @param window - The window.
 * @param row - The row.
 * @returns The x, CSS px.
 */
export function rowLeft(state: GraphState, window: PerfWindowView, row: number): number {
  return xOf(state, cell(window.t, row));
}

/**
 * The right x of a row's bar: the start of the next frame (the newest row's reaches `px1`), at
 * least 1 px right of its left.
 *
 * @param state - The painter state.
 * @param window - The window.
 * @param row - The row.
 * @returns The x, CSS px.
 */
export function rowRight(state: GraphState, window: PerfWindowView, row: number): number {
  const left = rowLeft(state, window, row);
  const right = row + 1 < window.count ? xOf(state, cell(window.t, row + 1)) : state.edgeX;
  return Math.max(right, left + 1);
}

/**
 * The centre x of a row's bar.
 *
 * @param state - The painter state.
 * @param window - The window.
 * @param row - The row.
 * @returns The x, CSS px.
 */
export function rowCentre(state: GraphState, window: PerfWindowView, row: number): number {
  return (rowLeft(state, window, row) + rowRight(state, window, row)) / 2;
}
