/**
 * @file perf/graph barrel — the only barrel of the module: the pure canvas-2D painter of the frame
 * graph, its state, its hit tests and the cause palette (the cockpit look). Runtime-free and
 * DOM-free; imported by the overlay (agent) and the tools strip (renderView), never through the perf
 * plugin. The tools page's light and dark looks are `themes.ts`, imported by path by the tools page
 * only and not re-exported here, so the agent bundle never carries them.
 */

export { rowAt, spikeAt } from "./hit";
export { msToPx, paintGraph } from "./paint";
export type { CauseStyle, GraphPalette } from "./palette";
export { CAUSE_STYLE, GRAPH_COLOURS, GRAPH_FONTS } from "./palette";
export { createGraphState, resetGraphText } from "./state";
export type {
  GraphContext2D,
  GraphFonts,
  GraphLayer,
  GraphLook,
  GraphState,
  GraphView
} from "./types";
