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
  PassesLineWire,
  PassKind,
  PassRowWire,
  PerfActivity,
  PerfCaps,
  PerfCause,
  PerfDetailWire,
  PerfEventsWire,
  PerfFeeds,
  PerfFramesWire,
  PerfHeaderLine,
  PerfHistory,
  PerfMemory,
  PerfMonitorState,
  PerfPassesSummary,
  PerfPassesWire,
  PerfPassRowsWire,
  PerfRangeSummary,
  PerfRate,
  PerfSampleLine,
  PerfSecond,
  PerfTimelineEvent,
  PerfTimelineLine,
  ProblemRule,
  RangeChain,
  RangePass,
  RangeSystem,
  RateMode,
  RateReason,
  RestState,
  ShaderWhat
} from "../../perf/protocol";
export {
  appendEvents,
  appendFrames,
  appendSample,
  appendSecond,
  CAUSE_BITS,
  CAUSE_RANK,
  causeName,
  clearPerfHistory,
  createPerfHistory,
  eventsOf,
  gpuShare,
  HISTORY_MS,
  HISTORY_ROWS,
  isTilerGpu,
  MONITOR_SECTIONS,
  nearestRank,
  PASS_KINDS,
  PROBLEM_RULES,
  passesSummaryOf,
  REST,
  rangeRows,
  rangeSummary,
  rateFps,
  readFramesWire,
  SECTION_DEFAULTS,
  SYSTEMS_PER_FRAME,
  sortHead,
  spikeCause
} from "../../perf/protocol";
export type {
  LogMark,
  RecorderSource,
  RecordOrigin,
  RecordStarter
} from "../../recorder/protocol";
