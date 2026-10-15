/**
 * @file renderView device strip — the one door to the contracts the strip reads (spec 09 §
 * Contracts this unit consumes): perf's runtime-free `perf/protocol` (the window, its wire form,
 * the values of the perf sources and the window helpers) and `perf/graph` (the painter, its
 * state, its hit tests and the cause palette: renderView keeps no copy) with the tools page's light
 * and dark looks (`perf/graph/themes`, kept out of the agent bundle), plus the recorder's
 * `RecorderStatus`, a type-only re-export of `recorder/types` (`./recorder.ts`). No plugin instance
 * of another core is imported.
 */
export type {
  CauseStyle,
  GraphContext2D,
  GraphLayer,
  GraphLook,
  GraphPalette,
  GraphState,
  GraphView
} from "../../../perf/graph";
export {
  CAUSE_STYLE,
  createGraphState,
  paintGraph,
  resetGraphText,
  rowAt,
  spikeAt
} from "../../../perf/graph";
export type { GraphTheme } from "../../../perf/graph/themes";
export { causeHue, GRAPH_PALETTES, graphLook } from "../../../perf/graph/themes";
export type {
  PerfFrameEvent,
  PerfRate,
  PerfRenderStats,
  PerfSecond,
  PerfSpikeRecord,
  PerfSpikeSummary,
  PerfWindow,
  PerfWindowView,
  PerfWindowWire
} from "../../../perf/protocol";
export {
  createPerfWindow,
  meanGpu,
  readWireWindow,
  rowOfFrame,
  spikeOrdinal,
  stepSpike
} from "../../../perf/protocol";
export type { RecorderStatus } from "./recorder";
