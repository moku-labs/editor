/**
 * @file perf/graph barrel — the only barrel of the module: the pure canvas-2D painter of the frame
 * graph, its state, its hit tests and the cause palette. Runtime-free and DOM-free; imported by the
 * overlay (agent) and the tools strip (renderView), never through the perf plugin.
 */

export { rowAt, spikeAt } from "./hit";
export { paintGraph } from "./paint";
export type { CauseStyle } from "./palette";
export { CAUSE_STYLE, GRAPH_COLOURS, GRAPH_FONTS } from "./palette";
export { createGraphState, resetGraphText } from "./state";
export type { GraphContext2D, GraphState, GraphView } from "./types";
