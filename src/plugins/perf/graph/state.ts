/**
 * @file perf/graph — the painter state of one canvas: made once, reset after a font load.
 */
import type { GraphState } from "./types";

/** Causes a legend width is kept for (CAUSE_RANK). */
const CAUSES = 7;

/**
 * Makes the painter state of one canvas: flag arrays of `capacity` (a window's spike count never
 * exceeds its rows), legends not measured, no cached label.
 *
 * @param capacity - The rows of the window this canvas paints.
 * @returns The state.
 * @example
 * ```ts
 * createGraphState(1024).measured; // false
 * ```
 */
export function createGraphState(capacity: number): GraphState {
  return {
    flagRow: new Int32Array(capacity),
    flagX0: new Float32Array(capacity),
    flagX1: new Float32Array(capacity),
    flagCount: 0,
    px0: 0,
    px1: 0,
    py0: 0,
    py1: 0,
    flagBand: 0,
    startMs: 0,
    spanMs: 1,
    legendWidth: new Float32Array(CAUSES).fill(Number.NaN),
    measured: false,
    readoutMs: Number.NaN,
    readoutText: "",
    captionKey: "",
    captionText: "",
    captionFrame: -1,
    captionOrdinal: -1,
    captionCount: -1,
    axisWindowMs: Number.NaN,
    axisText: [],
    tapeBudgetMs: Number.NaN,
    tapeBudgetText: "",
    tapeHalfText: "",
    rateText: new Map(),
    lookKey: "cockpit",
    edgeX: 0
  };
}

/**
 * Forgets the measured legends and every cached label: call after `document.fonts.ready`, so the
 * legends are measured in the look's own face (Barlow Condensed on the phone, Geist on the tools
 * page), not the fallback. A change of look resets them too.
 *
 * @param state - The painter state.
 */
export function resetGraphText(state: GraphState): void {
  state.measured = false;
  state.legendWidth.fill(Number.NaN);
  state.readoutMs = Number.NaN;
  state.readoutText = "";
  state.captionKey = "";
  state.captionText = "";
  state.captionFrame = -1;
  state.captionOrdinal = -1;
  state.captionCount = -1;
  state.axisWindowMs = Number.NaN;
  state.axisText.length = 0;
  state.tapeBudgetMs = Number.NaN;
  state.tapeBudgetText = "";
  state.tapeHalfText = "";
  state.rateText.clear();
}
