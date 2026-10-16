/**
 * @file perf/protocol — the editor's view of the engine's performance monitor (engine spec
 * 11-monitor, "11:<line>" below; frame rate from spec 21, kept pictures from spec 23, the overlay
 * detail from spec 22 O10.2, the pool trim and warm-up details from specs 25 and 27): the frame
 * ring, the log lines, their event details and the monitor itself. Runtime-free: only
 * `import type` / `export type` reach `@moku-labs/game`, so no engine code enters the tools or
 * server bundle.
 *
 * Every type is the engine's own, re-exported (the rate types from its `Time` namespace, the
 * monitor, `KeptStats` and the render stats from `Renderer`), except `DevtoolsDetail`, the detail of
 * the editor's own `devtools` event, which the engine names but does not type, and the mirrors of
 * the 0.15.x patch and the next engine change at the end of the file (spec 03 Delta 2026-10-16 D1):
 * the editor's structural copies until the installed engine exports them.
 * `engine-contract.test.ts` asserts each re-export equals the engine's type.
 */
import type { FrameRing, PassRecord, PerfEventName, Renderer, Time } from "@moku-labs/game";
import type { MonitorSectionName, MonitorSections } from "./sections";
import type { ProblemRule, ShaderWhat } from "./timeline";

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

// Mirrors of the 0.15.x patch and the next engine change (spec 03 Delta 2026-10-16 D1).
// The engine installed here (0.15.0) exports none of these yet: each is the editor's structural copy,
// optional for a reader (an older engine sends none of it). `engine-contract.test.ts` compares each
// with the engine's export once the engine has it (ask E7).

/**
 * The pass ring columns of the 0.15.x patch (E2, TC §2.1): the owner entity (0 = none), the filter
 * kind (`kind2`, 1-based, 0 = none: the name is `kindNames[kind2 - 1]`), the draw-call counter at
 * the pass's start, the target format and the resolution. Every column is absent on an older engine.
 *
 * @example
 * ```ts
 * const extra: PassColumnsNext = { owner: new Uint32Array(4096), kind2: new Uint8Array(4096), kindNames: ["fog.blur"] };
 * ```
 */
export type PassColumnsNext = {
  readonly owner?: Uint32Array;
  readonly kind2?: Uint8Array;
  readonly kindNames?: readonly string[];
  readonly drawsAt?: Uint16Array;
  readonly format?: readonly (string | null)[];
  readonly resolution?: Float32Array;
};

/**
 * The event names the 0.15.x patch and the next change add to the engine's `PerfEventName`: `shader`
 * (E4), `problem` (N3, two rules in 0.15.x), `debug` (U6, overdraw), `gc` (N6) and `sections` (N1).
 *
 * @example
 * ```ts
 * const name: PerfEventNameNext = "shader";
 * ```
 */
export type PerfEventNameNext = PerfEventName | "shader" | "problem" | "debug" | "gc" | "sections";

/**
 * The detail of a `shader` event line (E4): what was compiled (`"compile"` or `"module"` in 0.15.x;
 * `"variant"` / `"relink"` with the next change, kept as their string), its label, its ms, the
 * frame, whether it ran at boot, and the pass it ran during.
 *
 * @example
 * ```ts
 * const detail: ShaderEventDetail = { what: "compile", label: "fog.blur", ms: 38.2, frame: 4851, boot: false,
 *   during: { pass: 2, filter: "fog.blur", owner: 412, view: "fogLayer" } };
 * ```
 */
export type ShaderEventDetail = {
  readonly what: ShaderWhat;
  readonly label: string | null;
  readonly ms: number;
  readonly frame: number;
  readonly boot: boolean;
  readonly during: {
    readonly pass: number | null;
    readonly filter: string | null;
    readonly owner: number | null;
    readonly view: string | null;
  };
};

/**
 * The detail of a `problem` event line (N3): a rule that flagged an owner and view, or the same
 * rule cleared for them (`cleared` carries owner and view, engine U5). `filter-still` also says why
 * (`budget` or `not-eligible`).
 *
 * @example
 * ```ts
 * const flagged: ProblemEventDetail = { rule: "filter-still", severity: "warn", owner: 412, view: "fogLayer", filter: "fog.blur",
 *   value: 6.2, threshold: 2, since: 4802, frames: 53, reason: "budget" };
 * const cleared: ProblemEventDetail = { rule: "filter-still", cleared: true, owner: 412, view: "fogLayer" };
 * ```
 */
export type ProblemEventDetail =
  | {
      readonly rule: ProblemRule;
      readonly severity: "info" | "warn";
      readonly owner: number | null;
      readonly view: string | null;
      readonly filter: string | null;
      readonly value: number | null;
      readonly threshold: number | null;
      readonly since: number | null;
      readonly frames: number | null;
      readonly reason?: "budget" | "not-eligible";
    }
  | {
      readonly rule: ProblemRule;
      readonly cleared: true;
      readonly owner: number | null;
      readonly view: string | null;
    };

/**
 * The detail of a `gc` event line (N6, next change): MB freed, the heap after, and whether it is a
 * hint (inferred from a drop).
 *
 * @example
 * ```ts
 * const gc: GcEventDetail = { freedMb: 4.2, heapMb: 41.9, hint: true };
 * ```
 */
export type GcEventDetail = {
  readonly freedMb: number;
  readonly heapMb: number | null;
  readonly hint: boolean;
};

/**
 * The detail of a `sections` event line (N1, next change): the sections switched on and off.
 *
 * @example
 * ```ts
 * const switched: SectionsEventDetail = { on: ["passes", "shaders"], off: [] };
 * ```
 */
export type SectionsEventDetail = {
  readonly on: readonly MonitorSectionName[];
  readonly off: readonly MonitorSectionName[];
};

/**
 * The detail of a `debug` event line (engine U6): the overdraw heat map turned on or off; frames
 * drawn with it on are not real cost.
 *
 * @example
 * ```ts
 * const debug: DebugEventDetail = { overdraw: true };
 * ```
 */
export type DebugEventDetail = { readonly overdraw: boolean };

/**
 * The fields a `sample` line gains with the 0.15.x patch and the next change: render-target
 * churn (E5), the object counters (engine U3: entities, views, timers, frame listeners and the
 * registered counts), the shader counters (N7), the cost per section (N2) and the memory source
 * (N6, beside the kept `heapMb`).
 *
 * @example
 * ```ts
 * const extra: PerfSampleNext = { targets: { created: 6, destroyed: 6 }, counts: { entities: 104, views: 180, timers: 3, frameListeners: 2 } };
 * ```
 */
export type PerfSampleNext = {
  readonly targets?: { readonly created: number; readonly destroyed: number } | null;
  readonly counts?: {
    readonly entities: number;
    readonly views: number;
    readonly timers: number;
    readonly frameListeners: number;
    readonly [registered: string]: number;
  } | null;
  readonly shaders?: {
    readonly pipelines: number;
    readonly hits: number;
    readonly compiles: number;
    readonly variants: number;
    readonly relinks: number;
  } | null;
  readonly sectionsMs?: Readonly<Partial<Record<MonitorSectionName, number>>>;
  readonly memory?: {
    readonly source: "performance.memory" | "uasm" | "shell" | null;
    readonly heapMb: number | null;
    readonly processMb: number | null;
  };
};

/**
 * The fields the header gains with the 0.15.x patch and the next change: the app id (with the
 * `.debug` suffix on native debug installs, S-E3), the overdraw flag (U6) and the sections (N1).
 *
 * @example
 * ```ts
 * const extra: PerfHeaderNext = { app: { id: "com.moku.garden.debug" }, debug: { overdraw: false } };
 * ```
 */
export type PerfHeaderNext = {
  readonly app?: { readonly id: string };
  readonly debug?: { readonly overdraw: boolean };
  readonly sections?: MonitorSections;
};

/**
 * The fields the engine's `FrameRate` (the `game.frameRate` answer) gains with the 0.15.x patch (E6):
 * the rate the loop is told to hold (null only in mode `"auto"`) and who holds it back (`"panel"`:
 * the asked rate is above the display's).
 *
 * @example
 * ```ts
 * const held: FrameRateNext = { asked: 120, heldBy: "panel" }; // "This display runs at 60 Hz"
 * ```
 */
export type FrameRateNext = {
  readonly asked?: number | null;
  readonly heldBy?: "panel" | null;
};

/**
 * One filter chain of a `passes` summary (N4, next change): an owner and view's consecutive filter
 * passes over the second.
 *
 * @example
 * ```ts
 * const chain: PassesLineChain = { owner: 412, view: "fogLayer", kinds: ["fog.blur", "fog.blur"], applies: 120, mpx: 221.2, draws: 4,
 *   gpuMs: { p50: 6.2, max: 6.9 } };
 * ```
 */
export type PassesLineChain = {
  readonly owner: number | null;
  readonly view: string | null;
  readonly kinds: readonly string[];
  readonly applies: number;
  readonly mpx: number;
  readonly draws: number | null;
  readonly gpuMs: { readonly p50: number; readonly max: number } | null;
};

/**
 * The engine's per-second `passes` summary line (N4, next change): the chains of the second and the
 * heaviest drawn frame's passes. perf answers it as is (`source: "engine"`).
 *
 * @example
 * ```ts
 * const line: PerfPassesLine = { v: 1, kind: "passes", t: 81000, chains: [], heaviest: null };
 * ```
 */
export type PerfPassesLine = {
  readonly v: 1;
  readonly kind: "passes";
  readonly t: number;
  readonly chains: readonly PassesLineChain[];
  readonly heaviest: { readonly frame: number; readonly passes: readonly PassRecord[] } | null;
};
