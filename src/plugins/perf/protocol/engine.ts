/**
 * @file perf/protocol — the editor's view of the engine's performance monitor (engine spec
 * 11-monitor, "11:<line>" below; frame-rate types from spec 21): the frame ring, the log lines,
 * their event details and the monitor itself. Runtime-free: only `import type` / `export type`
 * reach `@moku-labs/game`, so no engine code enters the tools or server bundle.
 *
 * Where the engine exports a type with the shape spec 03 names, it is re-exported here unchanged
 * (the spec 21 rate types from its `Time` namespace, spec 23's `KeptStats` from `Renderer`). Where
 * the engine does not export it yet (spec 22 overlay, spec 25 pool trim, spec 27 warm-up, the
 * editor's `devtools` detail), the type is a structural copy; where the engine exports a type but a
 * later engine spec adds members to it (the `pool-trim` and `warm` event names, spec 26's
 * `redraws` / `rebuilds`), the editor adds them. `engine-contract.test.ts` compares every copy and
 * every addition with the engine.
 */
import type {
  PerfEventLine as EnginePerfEventLine,
  PerfEventName as EnginePerfEventName,
  FrameRing,
  PerfCollectorLine,
  PerfHeaderLine,
  PerfLongFrameLine,
  PerfMarkLine,
  PerfSampleLine,
  PerfSpikeLine,
  PerfStartupLine,
  PerfThermalLine,
  Renderer,
  Time
} from "@moku-labs/game";
import type { Json } from "../../registry/protocol";

export type {
  FrameColumns,
  FrameReadout,
  FrameReadResult,
  FrameRecord,
  FrameRing,
  LongFrameEntry,
  PassKind,
  PassRecord,
  PerfCause,
  PerfChange,
  PerfChangeEntry,
  PerfCollectorLine,
  PerfDisplay,
  PerfHeaderLine,
  PerfLongFrameLine,
  PerfMarkLine,
  PerfMeasured,
  PerfSampleLine,
  PerfSpikeLine,
  PerfStartupLine,
  PerfThermalLine
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
 * The names of event lines after blocks 3B and 4 (11:1052-1055, addendum 3B/4 item 1): the engine's
 * union plus `"pool-trim"` (spec 25 M1.8) and `"warm"` (spec 27 P2.3.8), not in the engine yet.
 * `overlay` is the game's overlays only; the editor's own window is `devtools`.
 *
 * @example
 * ```ts
 * const name: PerfEventName = "pool-trim"; // the filter texture pool was trimmed at rest
 * ```
 */
export type PerfEventName = EnginePerfEventName | "pool-trim" | "warm";

/**
 * Something that happened, at the frame it happened in (11:1056): the engine's event line, named by
 * the editor's `PerfEventName`. `frame` is null between frames.
 *
 * @example
 * ```ts
 * const line: PerfEventLine = { v: 1, kind: "event", t: 1760454000123.4, build: null, frame: 4811, name: "warm", detail: { draws: 18 } };
 * ```
 */
export type PerfEventLine = Omit<EnginePerfEventLine, "name"> & { name: PerfEventName };

/**
 * One line of the performance log, v1 (11:932-934): one JSON object per line of a `.jsonl` file.
 * The engine's nine kinds, with the editor's event names.
 *
 * @example
 * ```ts
 * const line: PerfLogLine = { v: 1, kind: "mark", t: 1760454000123.45, build: "debug-20261014T153012Z", label: "boss", auto: false };
 * ```
 */
export type PerfLogLine =
  | PerfHeaderLine
  | PerfStartupLine
  | PerfSampleLine
  | PerfSpikeLine
  | PerfLongFrameLine
  | PerfEventLine
  | PerfMarkLine
  | PerfThermalLine
  | PerfCollectorLine;

/**
 * What a game overlay did (engine spec 22 O10.2): the `what` of an `overlay` event. Structural.
 *
 * @example
 * ```ts
 * const what: OverlayWhat = "landed";
 * ```
 */
export type OverlayWhat = "open" | "landed" | "leave" | "gone" | "live" | "kept";

/**
 * The detail of a game `overlay` event line (spec 22 O10.2). `mode` is the engine's `OverlayMode`,
 * read as a string so a new mode shows instead of failing the guard. Structural.
 *
 * @example
 * ```ts
 * const detail: OverlayEventDetail = { entity: 412, label: "pause menu", what: "open", mode: "modal" };
 * ```
 */
export type OverlayEventDetail = {
  entity: number;
  label: string;
  what: OverlayWhat;
  mode: string;
};

/**
 * The detail of a `pool-trim` event line (spec 25 M1.8): why the filter texture pool was trimmed,
 * and the MB it freed. Structural.
 *
 * @example
 * ```ts
 * const trim: PoolTrimDetail = { reason: "rest", freedMb: 12.5 };
 * ```
 */
export type PoolTrimDetail = { reason: "rest" | "scene" | "pause"; freedMb: number };

/**
 * The detail of a `warm` event line (spec 27 P2.3.8): the draws of a pipeline warm-up run.
 * Structural.
 *
 * @example
 * ```ts
 * const warm: WarmDetail = { draws: 18 };
 * ```
 */
export type WarmDetail = { draws: number };

/**
 * The detail of the editor's own `devtools` event line (addendum 3B/4 item 1): the overlay window's
 * mode and tab. The recorder writes it; perf ignores it.
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
 * The members of the engine's `RenderStats` perf reads (11 R12.2, addendum 3B/4 item 3): the
 * engine's `renderPasses`, `renderPassesMax` and `kept` (spec 23), plus `redraws` / `rebuilds`
 * (spec 26, dev or agent builds only; not in the engine yet).
 *
 * @example
 * ```ts
 * const stats: RenderStatsLike = { renderPasses: 1, renderPassesMax: 3, kept: { pictures: 1, mb: 1.4, retakes: 0 }, redraws: 0, rebuilds: 0 };
 * ```
 */
export type RenderStatsLike = Pick<
  Renderer.RenderStats,
  "renderPasses" | "renderPassesMax" | "kept"
> & {
  redraws?: number;
  rebuilds?: number;
};

/**
 * The engine's performance monitor as the editor uses it: `app.renderer.monitor` of an agent build
 * (11-monitor R13.1, 11:1153-1158; the engine's `Renderer.PerfMonitorApi`). Structural, because
 * the editor's event names include `pool-trim` and `warm`; the engine's monitor is assignable to it
 * (`engine-contract.test.ts`). In a build without the agent flag every member exists and does
 * nothing: `frames()` answers a ring of capacity 0, `stream` never calls.
 *
 * @example
 * ```ts
 * // perf finds it on the game it wraps.
 * const monitor: MonitorLike | undefined = monitorOf(registry.game());
 * monitor?.frames().capacity; // 1024 on a debug build of the phone
 * ```
 */
export type MonitorLike = {
  /**
   * 11:1291-1314. The header (and startup) at once, then samples, spikes, long frames, events,
   * marks, thermal; each line fresh and deeply frozen.
   *
   * @param listener - Called with each line.
   * @returns The unsubscribe.
   */
  stream(listener: (line: PerfLogLine) => void): () => void;
  /**
   * 11:1317-1334. The same ring object on every call.
   *
   * @returns The frame ring.
   */
  frames(): FrameRing;
  /**
   * 11:1337-1349. A mark line, `auto: false`.
   *
   * @param label - The mark's label.
   */
  mark(label: string): void;
  /**
   * 11:1352-1369. An event line at the frame it happens in.
   *
   * @param name - The event name.
   * @param detail - The event detail.
   */
  event(name: PerfEventName, detail?: Readonly<Record<string, Json>>): void;
  /**
   * 11:1372-1394. Opens a span of agent work (a nested begin is ignored).
   */
  beginAgent(): void;
  /**
   * 11:1372-1394. Closes the span (an end without a begin is ignored); the engine also hands it to
   * `time.chargeAgent`.
   */
  endAgent(): void;
  /**
   * 11:1399-1418. The A/B resolution switch; the editor does not call it.
   *
   * @param resolution - The resolution, or undefined for the default.
   * @returns The resolution now.
   */
  setResolution(resolution: number | undefined): number;
};
