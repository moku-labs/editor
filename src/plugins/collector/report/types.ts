/**
 * @file collector/report — the report's types: a line of the computer file, the editor's gap line,
 * what `parsePerfLog` read, the per-screen and per-rate summary of a log and the A/B comparison of
 * two logs. Runtime-free: the line types come from `perf/protocol` (type-only).
 */
import type {
  OverlayWhat,
  PerfCause,
  PerfCollectorLine,
  PerfEventLine,
  PerfHeaderLine,
  PerfLogLine,
  PerfMarkLine,
  PerfSampleLine,
  PerfSpikeLine,
  PerfThermalLine
} from "../../perf/protocol";

/**
 * A line as the computer file holds it: the device's line plus `rx` (computer epoch ms at
 * receipt), or a line the collector wrote itself.
 *
 * @example
 * ```ts
 * const line: FileLine = { v: 1, kind: "mark", t: 5917.4, build: null, label: "boss", auto: false, rx: 1791986090000 };
 * ```
 */
export type FileLine = PerfLogLine & { readonly rx?: number };

/**
 * The editor's line for lines a device lost before sending (written by the collector).
 *
 * @example
 * ```ts
 * const gap: PerfGapLine = { v: 1, kind: "gap", t: 5917.4, build: null, rx: 1791986090000, device: "SM-A266B", lines: 12 };
 * ```
 */
export type PerfGapLine = {
  readonly v: 1;
  readonly kind: "gap";
  readonly t: number;
  readonly build: string | null;
  readonly rx: number;
  readonly device: string | null;
  readonly lines: number;
};

/**
 * A percentile read from a fixed-bucket histogram: the upper edge of the bucket, `over` for the
 * 200 ms+ bucket.
 *
 * @example
 * ```ts
 * const p99: HistPercentile = { ms: 200, over: true }; // printed "≥200"
 * ```
 */
export type HistPercentile = { readonly ms: number; readonly over: boolean };

/**
 * How many lines `parsePerfLog` skipped, by reason.
 *
 * @example
 * ```ts
 * const skipped: SkippedLines = { notJson: 1, noVersion: 0, otherVersion: 2, unknownKind: 0, badShape: 0 };
 * ```
 */
export type SkippedLines = {
  /** Not JSON: a log cut in the middle of a write. */
  readonly notJson: number;
  /** Not an object with a numeric `v`: the game's old log. */
  readonly noVersion: number;
  /** Another log version than PERF_LOG_VERSION. */
  readonly otherVersion: number;
  /** A kind the reader does not know. */
  readonly unknownKind: number;
  /** A known kind that failed its minimal check. */
  readonly badShape: number;
};

/**
 * What `parsePerfLog` read.
 *
 * @example
 * ```ts
 * const log: ParsedLog = parsePerfLog(await Bun.file(file).text());
 * log.samples.length; // 724
 * ```
 */
export type ParsedLog = {
  /** The first header. */
  readonly header: PerfHeaderLine | null;
  readonly samples: readonly PerfSampleLine[];
  readonly spikes: readonly PerfSpikeLine[];
  readonly marks: readonly PerfMarkLine[];
  /** The `rate` event lines (detail `RateChange`), in file order. */
  readonly rates: readonly PerfEventLine[];
  /**
   * The game's frame events in file order: `overlay` (spec 22 O10.2), `pool-trim` (spec 25 M1.8),
   * `warm` (spec 27 P2.3.8).
   */
  readonly frameEvents: readonly PerfEventLine[];
  readonly thermal: readonly PerfThermalLine[];
  readonly gfx: readonly PerfCollectorLine[];
  /** Σ gap.lines: lines the device lost before sending. */
  readonly lost: number;
  /**
   * `telemetry` lines read: the collector's wired-device line, an editor kind like `gap`, counted
   * and summarized nowhere else (no report section in v1).
   */
  readonly telemetry: number;
  /** Non-empty lines read. */
  readonly lines: number;
  readonly skipped: SkippedLines;
};

/**
 * One screen (flow path) at one frame rate of a log: the same screen at 120 and at 60 fps are two
 * rows.
 *
 * @example
 * ```ts
 * const row: ScreenSummary = summarize(log).screens[0]; // { path: "garden/boss", rate: 120, seconds: 480, … }
 * ```
 */
export type ScreenSummary = {
  readonly path: string;
  /**
   * The loop's rate in fps for these seconds; null when the log never names one (an engine before
   * spec 21 without `header.config.maxFps`).
   */
  readonly rate: number | null;
  /** Σ sample.windowMs / 1000. */
  readonly seconds: number;
  /** Σ of the merged frameHist. */
  readonly frames: number;
  readonly p50: HistPercentile | null;
  readonly p90: HistPercentile | null;
  readonly p99: HistPercentile | null;
  /** Mean of sample.gpuMs.p50 weighted by gpuMs.frames; null when no second has a GPU timer. */
  readonly gpuMs: number | null;
  readonly spikes: number;
  readonly spikesPerMin: number;
  /** Primary cause counts, most first. */
  readonly causes: readonly (readonly [PerfCause, number])[];
  /** Mean of sample.passes.mean weighted by sample.drawn; null without passes. */
  readonly passes: number | null;
  /** Max of the screen; kept = sample.kept.mb (spec 23 P12.2), else sample.textures.kept. */
  readonly textureMb: { readonly art: number; readonly targets: number; readonly kept: number };
  /** Max; null when no second measured the heap. */
  readonly heapMb: number | null;
  /** Pool trims in these seconds and the MB they freed (Σ `freedMb`). */
  readonly poolTrims: { readonly count: number; readonly freedMb: number };
  /** Pipeline warm-ups that ended in these seconds and their draws (Σ `draws`). */
  readonly warmUps: { readonly count: number; readonly draws: number };
  /** The game's overlay changes: one entry per `label` + `what`, in first-seen order. */
  readonly overlays: readonly {
    readonly label: string;
    readonly what: OverlayWhat;
    readonly count: number;
  }[];
};

/**
 * The heat of one device over a log.
 *
 * @example
 * ```ts
 * const heat: HeatSummary = { device: "SM-A266B", batteryC: { first: 31.2, last: 38, max: 38.4 }, status: { first: 0, last: 1, max: 1 }, sensors: [{ name: "SKIN", first: 33.1, last: 38.4 }] };
 * ```
 */
export type HeatSummary = {
  readonly device: string;
  readonly batteryC: {
    readonly first: number | null;
    readonly last: number | null;
    readonly max: number | null;
  };
  readonly status: {
    readonly first: number | null;
    readonly last: number | null;
    readonly max: number | null;
  };
  /** Hottest last first, at most 4. */
  readonly sensors: readonly {
    readonly name: string;
    readonly first: number;
    readonly last: number;
  }[];
};

/**
 * System frames (adb gfxinfo) of one device between two marks.
 *
 * @example
 * ```ts
 * const system: SystemSummary = { device: "SM-A266B", mark: "(start)", seconds: 60, frames: 3600, fps: 60, latePct: 1.2, p50: 16, p90: 19, p99: 25 };
 * ```
 */
export type SystemSummary = {
  readonly device: string;
  readonly mark: string;
  readonly seconds: number;
  readonly frames: number;
  readonly fps: number;
  readonly latePct: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
};

/**
 * The whole summary of one log.
 *
 * @example
 * ```ts
 * const summary: LogSummary = summarize(parsePerfLog(text));
 * summary.screens.map(screen => `${screen.path} @${screen.rate}`); // ["garden/boss @120", "garden/boss @60"]
 * ```
 */
export type LogSummary = {
  readonly device: {
    readonly model: string | null;
    readonly backend: string | null;
    readonly engine: string | null;
    readonly build: string | null;
  };
  /** Σ sample.windowMs / 1000 over the whole log. */
  readonly seconds: number;
  /** By seconds, longest first. */
  readonly screens: readonly ScreenSummary[];
  readonly heat: readonly HeatSummary[];
  readonly system: readonly SystemSummary[];
  /** `at`: seconds from the first sample. */
  readonly marks: readonly {
    readonly at: number;
    readonly label: string;
    readonly auto: boolean;
  }[];
  /** Every rate switch of the log, in order: `at` seconds from the first sample, from the `rate` event's detail. */
  readonly rateSwitches: readonly {
    readonly at: number;
    readonly from: number;
    readonly to: number;
    readonly reason: string;
    readonly mode: string;
  }[];
  readonly lost: number;
  /** `telemetry` lines read (the wired device's line; the footer's count, no table). */
  readonly telemetry: number;
  /** Non-empty lines read (the footer's count). */
  readonly lines: number;
  readonly skipped: SkippedLines;
};

/**
 * A compared metric: values, the change in percent of A, and the arrow when |change| ≥ 10 %.
 *
 * @example
 * ```ts
 * const p90: Delta = { a: 18, b: 13, pct: -28, arrow: "▼" };
 * ```
 */
export type Delta = {
  readonly a: number | null;
  readonly b: number | null;
  readonly pct: number | null;
  readonly arrow: "▲" | "▼" | null;
};

/**
 * One screen at one rate of a comparison. Every compared metric is "lower is better", so ▲ is
 * worse.
 *
 * @example
 * ```ts
 * const row: CompareRow = compare(a, b).rows[0]; // { path: "garden/boss", rate: 120, p90: { a: 18, b: 13, pct: -28, arrow: "▼" }, …, worse: [] }
 * ```
 */
export type CompareRow = {
  readonly path: string;
  readonly rate: number | null;
  readonly p90: Delta;
  readonly p99: Delta;
  readonly spikesPerMin: Delta;
  readonly gpuMs: Delta;
  /** The metrics that got worse by 10 % or more. */
  readonly worse: readonly ("p90" | "p99" | "spikes" | "gpu")[];
};

/**
 * The A/B comparison of two logs, by screen and rate.
 *
 * @example
 * ```ts
 * const comparison: Comparison = compare(summarize(parsePerfLog(a)), summarize(parsePerfLog(b)));
 * ```
 */
export type Comparison = {
  readonly rows: readonly CompareRow[];
  readonly a: LogSummary;
  readonly b: LogSummary;
};
