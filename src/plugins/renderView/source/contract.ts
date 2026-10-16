/**
 * @file renderView source — the one door to the other units' runtime-free modules (spec 09 § M14):
 * perf/protocol (the history and its functions, the feeds' wire types, the monitoring constants),
 * and, type-only, recorder/protocol, activeSource/types and connect/protocol. Every Mission control
 * file imports them from here, so the tools bundle's edges to other plugins are one file to read: no
 * plugin index, no agent or server code, and no `perf/graph` (the tools page paints with its own
 * `timeline/`).
 */
export type {
  ActiveSource,
  ActiveSourceApi,
  ConnectRequest,
  LocalPreview,
  SourceChange,
  SourceHealth,
  SourceLabel,
  SourceMarker
} from "../../activeSource/types";
export type {
  DeviceDirectory,
  DeviceTelemetry,
  GpuLoad,
  HeapGc,
  HeapSample,
  LinkedEntry,
  ListenInfo,
  PairAsk,
  ProcessCpu,
  ProcessMemory,
  Reading,
  ReadingOffReason,
  WireDevice
} from "../../connect/protocol";
export type {
  AppendResult,
  FrameRate,
  FrameRateNext,
  MonitorSectionName,
  MonitorSections,
  PassChainSummary,
  PassKind,
  PassRowWire,
  PerfCaps,
  PerfCause,
  PerfDetailWire,
  PerfEventsWire,
  PerfFramesWire,
  PerfHistory,
  PerfMemory,
  PerfMonitorState,
  PerfPassesWire,
  PerfPassRowsWire,
  PerfRangeSummary,
  PerfSecond,
  PerfTimelineEvent,
  RangeChain,
  RangePass,
  RangeSystem,
  RateMode,
  RateReason,
  RestState
} from "../../perf/protocol";
export {
  appendEvents,
  appendFrames,
  appendSecond,
  CAUSE_BITS,
  CAUSE_RANK,
  clearPerfHistory,
  createPerfHistory,
  gpuShare,
  HISTORY_MS,
  isTilerGpu,
  MONITOR_SECTIONS,
  REST,
  rangeRows,
  rangeSummary,
  rateFps,
  readFramesWire,
  SECTION_DEFAULTS,
  SYSTEMS_PER_FRAME
} from "../../perf/protocol";
export type {
  LogMark,
  RecorderSource,
  RecordOrigin,
  RecordStarter
} from "../../recorder/protocol";
