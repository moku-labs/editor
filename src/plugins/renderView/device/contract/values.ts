/**
 * @file renderView device strip — STAND-IN for the value types of spec 03 `perf/protocol/values.ts`
 * and spec 05 `recorder/types.ts` (`RecorderStatus`). Unit 03 (perf) and unit 05 (recorder) are
 * not built yet (decision "Build the engine-free part now"), so the tools strip reads the wire
 * values through these structural copies, word for word the owners' specs. When 03 and 05 land,
 * `contract/index.ts` re-exports their names instead and this file is deleted; nothing else in
 * renderView changes. Types only: no runtime code.
 */
import type {
  KeptStats,
  OverlayWhat,
  PerfCause,
  PerfChange,
  PerfDisplay,
  PerfHeaderLine,
  PerfSampleLine,
  PerfSpikeLine,
  PoolTrimDetail,
  RateMode,
  RateReason
} from "../../../perf/protocol";

/**
 * Why perf has no monitor: a headless game (no renderer), or an engine before block 2b.
 */
export type PerfOffReason = "no-renderer" | "no-monitor";

/**
 * What perf can measure now (spec 03). "waiting": the monitor exists but its ring is empty.
 *
 * @example
 * ```ts
 * const status: PerfStatus = { state: "on", lost: 0, gpuTimer: true };
 * ```
 */
export type PerfStatus =
  | { readonly state: "on"; readonly lost: number; readonly gpuTimer: boolean }
  | { readonly state: "waiting" }
  | { readonly state: "off"; readonly reason: PerfOffReason };

/**
 * The loop's frame rate as perf knows it (spec 03).
 *
 * @example
 * ```ts
 * const rate: PerfRate = { fps: 120, mode: "auto", reason: "start", displayHz: 120, switches: 0 };
 * ```
 */
export type PerfRate = {
  /** Frames per second of the newest row (`rateFps(rateMs)`); null while the window is empty. */
  readonly fps: number | null;
  readonly mode: RateMode | null;
  readonly reason: RateReason | null;
  readonly displayHz: number | null;
  /** Rate switches inside the window. */
  readonly switches: number;
};

/**
 * What perf reads from `renderer.stats()` (spec 03). A key the engine does not answer is null.
 *
 * @example
 * ```ts
 * const render: PerfRenderStats = { passesMax: 1, kept: { pictures: 4, mb: 1.6, retakes: 0 }, redraws: 0, rebuilds: 0 };
 * ```
 */
export type PerfRenderStats = {
  readonly passesMax: number | null;
  readonly kept: KeptStats | null;
  readonly redraws: number | null;
  readonly rebuilds: number | null;
};

/**
 * The value of `editor.perf.second` (spec 03): the window's fps and spike count, and the newest
 * sample and screen facts as the engine sent them.
 *
 * @example
 * ```ts
 * const second: PerfSecond = { state: "on", fps: { loop: 60, drawn: 54 }, spikes: 6, budgetMs: 16.67,
 *   rate: { fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 },
 *   render: null, sample: null, display: null, device: null, gpu: null, build: null, engine: null };
 * ```
 */
export type PerfSecond = {
  readonly state: PerfStatus["state"];
  readonly fps: { readonly loop: number; readonly drawn: number };
  readonly spikes: number;
  /** The newest frame's own budget; 16.7 while the window is empty. */
  readonly budgetMs: number;
  readonly rate: PerfRate;
  readonly render: PerfRenderStats | null;
  readonly sample: PerfSampleLine | null;
  readonly display: PerfDisplay | null;
  readonly device: PerfHeaderLine["device"] | null;
  readonly gpu: PerfHeaderLine["gpu"] | null;
  /** header.build: spec 10's build id. */
  readonly build: string | null;
  /** header.engine: spec 10's engine fingerprint. */
  readonly engine: string | null;
};

/**
 * A frame event of the game that a spike record lists under "what changed" (spec 03).
 *
 * @example
 * ```ts
 * const opened: PerfFrameEvent = { kind: "overlay", frame: 4812, label: "shopDimLayer", what: "open", mode: "freeze" };
 * ```
 */
export type PerfFrameEvent =
  | {
      readonly kind: "overlay";
      readonly frame: number;
      readonly label: string;
      readonly what: OverlayWhat;
      readonly mode: string;
    }
  | {
      readonly kind: "pool-trim";
      readonly frame: number;
      readonly reason: PoolTrimDetail["reason"];
      readonly freedMb: number;
    }
  | { readonly kind: "warm"; readonly frame: number; readonly draws: number };

/**
 * One spike of the window (spec 03), the value list of `editor.perf.spikes`.
 *
 * @example
 * ```ts
 * const spike: PerfSpikeSummary = { frame: 4812, agoMs: 980, ms: 41.3, budgetMs: 16.7, overMs: 24.6, cause: "upload",
 *   causes: ["upload", "gap"], jsMs: 8, gpuMs: 6.6, path: "garden/boss", why: "41.0 MB of textures uploaded this frame" };
 * ```
 */
export type PerfSpikeSummary = {
  readonly frame: number;
  /** ms before the newest frame of the window. */
  readonly agoMs: number;
  readonly ms: number;
  /** The frame's own budget: the budget the engine's spike rule used for this frame. */
  readonly budgetMs: number;
  /** ms − budgetMs. */
  readonly overMs: number;
  /** The primary cause by CAUSE_RANK. */
  readonly cause: PerfCause;
  /** Every cause, primary first. */
  readonly causes: readonly PerfCause[];
  readonly jsMs: number;
  readonly gpuMs: number | null;
  readonly path: string;
  /** One sentence: why this frame was late. */
  readonly why: string;
};

/**
 * The spike record (spec 03, design §7): the value of `editor.perf.spike { frame }`.
 */
export type PerfSpikeRecord = PerfSpikeSummary & {
  readonly at: number | null;
  /** The frame's rate in fps. */
  readonly fps: number;
  /** The rate switch at this frame (fps from and to); null: no switch here. */
  readonly rateSwitch: {
    readonly from: number;
    readonly to: number;
    readonly reason: RateReason | null;
    readonly mode: RateMode | null;
  } | null;
  readonly gapMs: number | null;
  readonly drawn: boolean;
  readonly gpuPartial: boolean;
  readonly phases: {
    readonly input: number;
    readonly animate: number;
    readonly layout: number;
    readonly sync: number;
    readonly signals: number;
    readonly render: number;
    readonly agent: number;
  } | null;
  readonly passes: number | null;
  readonly draws: number | null;
  readonly filters: { readonly applies: number; readonly mpx: number } | null;
  readonly uploads: { readonly count: number; readonly mb: number } | null;
  readonly compiles: number | null;
  readonly changed: readonly PerfChange[];
  readonly events: readonly PerfFrameEvent[];
  /** The engine's spike line; null until it arrives. */
  readonly detail: PerfSpikeLine | null;
};

/**
 * The value of `editor.recorder` (spec 05 `RecorderStatus`): the log and the outbox.
 *
 * @example
 * ```ts
 * const status: RecorderStatus = { state: "recording", lines: 1840, bytes: 412_000, sent: 1790, pending: 50, monitor: true,
 *   file: "perf-20261014-1532-sm-a266b.jsonl", label: null, sinceMs: 192_000, storage: "opfs", dropped: 0 };
 * ```
 */
export type RecorderStatus = {
  readonly state: "idle" | "recording" | "exporting";
  readonly lines: number;
  readonly bytes: number;
  readonly sent: number;
  readonly pending: number;
  readonly monitor: boolean;
  readonly file: string | null;
  readonly label: string | null;
  /** ms since the current log started; 0 while idle. */
  readonly sinceMs: number;
  readonly storage: "opfs" | "memory";
  readonly dropped: number;
};
