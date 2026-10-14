/**
 * @file renderView device strip — the one door to the perf and recorder contracts the strip reads
 * (spec 09 § Contracts this unit consumes). Today it re-exports the STAND-INS of this folder,
 * because units 03 (perf: `perf/protocol` window and values, `perf/graph`) and 05 (recorder:
 * `RecorderStatus`) are not built yet. When they land, this barrel becomes
 * `export … from "../../../perf/protocol"`, `"../../../perf/graph"` and `import type` from
 * `"../../../recorder/types"`, the stand-in files are deleted, and nothing else in renderView
 * changes (spec 09 § Engine-ship follow-ups).
 */
export type {
  CauseStyle,
  GraphContext2D,
  GraphState,
  GraphView
} from "./graph";
export {
  CAUSE_STYLE,
  createGraphState,
  paintGraph,
  resetGraphText,
  rowAt,
  spikeAt
} from "./graph";
export type {
  PerfFrameEvent,
  PerfRate,
  PerfRenderStats,
  PerfSecond,
  PerfSpikeRecord,
  PerfSpikeSummary,
  RecorderStatus
} from "./values";
export type { PerfWindow, PerfWindowView, PerfWindowWire } from "./window";
export {
  createPerfWindow,
  meanGpu,
  readWireWindow,
  rowOfFrame,
  spikeOrdinal,
  stepSpike
} from "./window";
