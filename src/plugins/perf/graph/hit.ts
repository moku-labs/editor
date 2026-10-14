/**
 * @file perf/graph — the hit tests of a painted graph: the spike under a tap and the row under an x.
 * They read the layout and the flag boxes the last `paintGraph` left in the state. No allocation.
 */
import type { PerfWindowView } from "../protocol";
import { cell, rowCentre } from "./geometry";
import type { GraphState } from "./types";

/** A tap this close to a flag box still hits it, px. */
const FLAG_SLOP = 4;

/** A tap this close to a spike bar's centre hits it, px. */
const BAR_SLOP = 9;

/**
 * The spike under a tap at CSS px `(x, y)`: inside the flag band on a flag box ± 4 px, its row;
 * else the spike bar whose centre is nearest, within 9 px.
 *
 * @param state - The painter state of the last paint.
 * @param window - The window it painted.
 * @param x - CSS px from the canvas's left.
 * @param y - CSS px from its top.
 * @returns The row; −1 for none.
 * @example
 * ```ts
 * spikeAt(graph, window, 120, 8); // 290: the flag of the spike at row 290
 * ```
 */
export function spikeAt(state: GraphState, window: PerfWindowView, x: number, y: number): number {
  if (y <= state.flagBand + 6) {
    for (let index = 0; index < state.flagCount; index += 1) {
      const left = cell(state.flagX0, index) - FLAG_SLOP;
      const right = cell(state.flagX1, index) + FLAG_SLOP;
      if (x >= left && x <= right) return state.flagRow[index] ?? -1;
    }
  }

  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < window.spikeCount; index += 1) {
    const row = cell(window.spikes, index);
    const away = Math.abs(rowCentre(state, window, row) - x);
    if (away <= BAR_SLOP && away < distance) {
      best = row;
      distance = away;
    }
  }
  return best;
}

/**
 * The row under `x` by time (binary search on `t`), clamped to the window.
 *
 * @param state - The painter state of the last paint.
 * @param window - The window it painted.
 * @param x - CSS px from the canvas's left.
 * @returns The row; −1 for an empty window.
 * @example
 * ```ts
 * rowAt(graph, window, 0); // 0: left of the plot clamps to the oldest row
 * ```
 */
export function rowAt(state: GraphState, window: PerfWindowView, x: number): number {
  if (window.count === 0) return -1;
  const width = Math.max(1, state.px1 - state.px0);
  const t = state.startMs + ((x - state.px0) / width) * state.spanMs;
  let low = 0;
  let high = window.count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (cell(window.t, middle) <= t) low = middle;
    else high = middle - 1;
  }
  return low;
}
