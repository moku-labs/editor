/**
 * @file collector/report barrel — the only barrel of the collector. Runtime-free and pure: parse a
 * PerfLogLine v1 file, summarize it per screen and rate, compare two logs, and print both as text
 * tables. Imported by relative path (pages' `perf summary` / `perf compare`, the collector's live
 * digest), never through the collector plugin; it imports only its own files and `perf/protocol`.
 */
export { COMPARE_THRESHOLD, compare } from "./compare";
export { bucketUpper, gfxPercentile, histPercentile } from "./hist";
export { isPerfLog, parsePerfLog } from "./parse";
export { headerRate, primaryOf, rankCauses, summarize } from "./summary";
export { compareText, groupThousands, summaryText, table } from "./text";
export type {
  CompareRow,
  Comparison,
  Delta,
  FileLine,
  HeatSummary,
  HistPercentile,
  LogSummary,
  ParsedLog,
  PerfGapLine,
  ScreenSummary,
  SkippedLines,
  SystemSummary
} from "./types";
