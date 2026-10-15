/**
 * @file perf/protocol — the editor's view of the engine's performance monitor (engine spec
 * 11-monitor, "11:<line>" below; frame rate from spec 21, kept pictures from spec 23, the overlay
 * detail from spec 22 O10.2, the pool trim and warm-up details from specs 25 and 27): the frame
 * ring, the log lines, their event details and the monitor itself. Runtime-free: only
 * `import type` / `export type` reach `@moku-labs/game`, so no engine code enters the tools or
 * server bundle.
 *
 * Every type is the engine's own, re-exported (the rate types from its `Time` namespace, the
 * monitor, `KeptStats` and the render stats from `Renderer`). The only editor type left is
 * `DevtoolsDetail`, the detail of the editor's own `devtools` event, which the engine names but
 * does not type. `engine-contract.test.ts` asserts each re-export equals the engine's type.
 */
import type { FrameRing, Renderer, Time } from "@moku-labs/game";

export type {
  FrameColumns,
  FrameReadout,
  FrameReadResult,
  FrameRecord,
  FrameRing,
  LongFrameEntry,
  OverlayEventDetail,
  OverlayWhat,
  PassKind,
  PassRecord,
  PerfCause,
  PerfChange,
  PerfChangeEntry,
  PerfCollectorLine,
  PerfDisplay,
  PerfEventLine,
  PerfEventName,
  PerfHeaderLine,
  PerfLogLine,
  PerfLongFrameLine,
  PerfMarkLine,
  PerfMeasured,
  PerfSampleLine,
  PerfSpikeLine,
  PerfStartupLine,
  PerfThermalLine,
  PoolTrimDetail,
  WarmDetail
} from "@moku-labs/game";

/**
 * The version every log line carries as `v` (11:930, 11:1135). The editor keeps its own constant: a
 * value import from the engine root would pull the engine into the tools bundle. The contract test
 * compares it with the engine's `PERF_LOG_VERSION`.
 */
export const PERF_LOG_VERSION = 1;

/**
 * Buckets of a sample's `frameHist` (11:1006-1007): [0,1) … [49,50) ms, then [50,55) … [195,200) ms,
 * then 200 ms and over. The contract test compares it with the engine's `PERF_GAP_BUCKETS`.
 */
export const PERF_GAP_BUCKETS = 81;

/**
 * The frame phases in the engine's order (11:731, 11:1016): `phaseMs` holds 6 values a frame, at
 * `slot * 6 + phase index`. The engine's `PHASES` is internal to `time`; the contract test reads
 * the order back through the engine's `frameAt`.
 */
export const PHASES = ["input", "animate", "layout", "sync", "signals", "render"] as const;

/**
 * The render-pass ring of `FrameRing.passes` (11:762-767), named here: the engine inlines it.
 *
 * @example
 * ```ts
 * const passes: PassColumns = app.renderer.monitor.frames().passes;
 * passes.capacity; // 4096: four passes for each of the 1024 frames
 * ```
 */
export type PassColumns = FrameRing["passes"];

/**
 * The native shell's thermal reading (`Time.ThermalReading`, 11:271-293): a field the shell left out
 * is `null`. The engine's own type.
 *
 * @example
 * ```ts
 * const reading: ThermalReading = { status: 2, headroom: 0.71, at: 1791986090000, android: null };
 * ```
 */
export type ThermalReading = Time.ThermalReading;

/**
 * The engine's frame-rate mode (spec 21 G1.3, `Time.RateMode`): `"fixed"` (`maxFps`), `"auto"` (the
 * adaptive rule), `"forced"` (`setRate` with a number).
 *
 * @example
 * ```ts
 * const mode: RateMode = "auto";
 * ```
 */
export type RateMode = Time.RateMode;

/**
 * Why the rate is what it is: the reason of the last change (spec 21 G1.3, `Time.RateReason`).
 *
 * @example
 * ```ts
 * const reason: RateReason = "missed"; // the loop fell back to 60 after missed frames
 * ```
 */
export type RateReason = Time.RateReason;

/**
 * The native shell's thermal status, normalized (spec 21 G1.3, `Time.ThermalStatus`).
 *
 * @example
 * ```ts
 * const status: ThermalStatus = "moderate";
 * ```
 */
export type ThermalStatus = Time.ThermalStatus;

/**
 * The loop's frame rate as `app.time.rate()` answers it (spec 21 G1.3, `Time.FrameRate`); the
 * header's `rate`.
 *
 * @example
 * ```ts
 * const rate: FrameRate = { fps: 60, mode: "auto", reason: "missed", displayHz: 120, ladder: [120, 60], thermal: "none" };
 * ```
 */
export type FrameRate = Time.FrameRate;

/**
 * A change of the loop's rate or of its mode (spec 21 G1.3, `Time.RateChange`): the payload of
 * `time:rate` and the `detail` of a `rate` event line.
 *
 * @example
 * ```ts
 * const change: RateChange = { from: 120, to: 60, reason: "missed", mode: "auto", displayHz: 120, thermal: "none", window: { drawn: 41, missed: 9, heavy: 0 }, dwellMs: 5000 };
 * ```
 */
export type RateChange = Time.RateChange;

/**
 * The detail of the editor's own `devtools` event line (addendum 3B/4 item 1): the overlay window's
 * mode and tab. The recorder writes it; perf ignores it. The engine lists the name but leaves the
 * detail to the editor, so this is the editor's own type.
 *
 * @example
 * ```ts
 * const devtools: DevtoolsDetail = { mode: "card", tab: "frames" };
 * ```
 */
export type DevtoolsDetail = { mode: "hidden" | "pill" | "card"; tab: string };

/**
 * Kept pictures of the last drawn frame (spec 23 P12.1, `Renderer.KeptStats`): pictures drawn as one
 * texture, the MiB their textures hold, and the pictures taken in the last full second.
 *
 * @example
 * ```ts
 * const kept: KeptStats = { pictures: 1, mb: 1.4, retakes: 0 };
 * ```
 */
export type KeptStats = Renderer.KeptStats;

/**
 * The members of the engine's `RenderStats` perf reads (11 R12.2, addendum 3B/4 item 3; 23 P12.1;
 * 26 R2.3.3): `renderPasses`, `renderPassesMax` and `kept` in every build, `redraws` and `rebuilds`
 * in dev or agent builds only.
 *
 * @example
 * ```ts
 * const stats: RenderStatsLike = { renderPasses: 1, renderPassesMax: 3, kept: { pictures: 1, mb: 1.4, retakes: 0 }, redraws: 0, rebuilds: 0 };
 * ```
 */
export type RenderStatsLike = Pick<
  Renderer.RenderStats,
  "renderPasses" | "renderPassesMax" | "kept" | "redraws" | "rebuilds"
>;

/**
 * The engine's performance monitor as the editor uses it: `app.renderer.monitor` of an agent build
 * (11-monitor R13.1, 11:1153-1158), the engine's `Renderer.PerfMonitorApi`. In a build without the
 * agent flag every member exists and does nothing: `frames()` answers a ring of capacity 0, `stream`
 * never calls.
 *
 * @example
 * ```ts
 * // perf finds it on the game it wraps.
 * const monitor: MonitorLike | undefined = monitorOf(registry.game());
 * monitor?.frames().capacity; // 1024 on a debug build of the phone
 * ```
 */
export type MonitorLike = Renderer.PerfMonitorApi;
