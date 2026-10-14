/**
 * @file perf/protocol — the values of the perf API and of the `editor.perf.*` sources. Plain
 * JSON-safe data: "not measured" is `null`, never `NaN`. The tools page reads them from the sources,
 * the overlay from the API. Types only.
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
} from "./engine";

/**
 * Why perf has no monitor: a headless game (no renderer), or an engine before block 2b.
 *
 * @example
 * ```ts
 * const reason: PerfOffReason = "no-renderer"; // a headless test game
 * ```
 */
export type PerfOffReason = "no-renderer" | "no-monitor";

/**
 * What perf can measure now. "waiting": the monitor exists but its ring is empty (capacity 0: the
 * agent flag is off, or the renderer has not attached yet).
 *
 * @example
 * ```ts
 * app.perf.status(); // { state: "on", lost: 0, gpuTimer: true } on the phone
 * ```
 */
export type PerfStatus =
  | { readonly state: "on"; readonly lost: number; readonly gpuTimer: boolean }
  | { readonly state: "waiting" }
  | { readonly state: "off"; readonly reason: PerfOffReason };

/**
 * The loop's frame rate as perf knows it: `fps` from the newest row's `rateMs`; `mode`, `reason`,
 * `displayHz` from the newest `rate` event (`RateChange`), else from the header's `rate`
 * (`FrameRate`, spec 21), else null (an engine before spec 21).
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
  /** Rate switches inside the window (rows whose `rateMs` differs from the row before). */
  readonly switches: number;
};

/**
 * What perf reads from `renderer.stats()` (11 R12.2, addendum 3B/4 item 3; 23 P12.1; 26 R2.3.3). A
 * key the engine does not answer is null (an engine before spec 23 has no `kept`; a production
 * build has no `redraws`).
 *
 * @example
 * ```ts
 * // The memory screen at rest on a debug build, its lamps kept.
 * const render: PerfRenderStats = { passesMax: 1, kept: { pictures: 4, mb: 1.6, retakes: 0 }, redraws: 0, rebuilds: 0 };
 * ```
 */
export type PerfRenderStats = {
  /** `stats().renderPassesMax`. */
  readonly passesMax: number | null;
  /** `stats().kept`: pictures drawn as one texture, the MB they hold, retakes in the last second. */
  readonly kept: KeptStats | null;
  /** `stats().redraws`: the engine's Graphics redraws in the last second (dev and agent builds). */
  readonly redraws: number | null;
  /** `stats().rebuilds`: Pixi's instruction rebuilds in the last second (dev and agent builds). */
  readonly rebuilds: number | null;
};

/**
 * The pill, the header and the counters: the window's fps and spike count, and the newest sample
 * and screen facts as the engine sent them.
 *
 * @example
 * ```ts
 * const second: PerfSecond = { state: "on", fps: { loop: 60, drawn: 54 }, spikes: 6, budgetMs: 16.67,
 *   rate: { fps: 60, mode: "auto", reason: "missed", displayHz: 120, switches: 1 },
 *   render: { passesMax: 3, kept: { pictures: 1, mb: 1.4, retakes: 0 }, redraws: 0, rebuilds: 0 },
 *   sample: null, display: null, device: null, gpu: null, build: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" };
 * ```
 */
export type PerfSecond = {
  readonly state: PerfStatus["state"];
  /** Frames of the last 1000 ms of the window: run by the loop, drawn by the renderer. */
  readonly fps: { readonly loop: number; readonly drawn: number };
  /** Spikes in the window (the one-window rule, design §4). */
  readonly spikes: number;
  /** The newest frame's own budget (its `budgetMs` column); 16.7 while the window is empty. */
  readonly budgetMs: number;
  /** The loop's rate now and who decides it (counters, device row). */
  readonly rate: PerfRate;
  /** `renderer.stats()` read when this value was built; null when the renderer has no `stats` or it threw. */
  readonly render: PerfRenderStats | null;
  /** The newest `sample` line, as the engine sent it; null before the first. */
  readonly sample: PerfSampleLine | null;
  /** header.display, replaced by every `display` event. */
  readonly display: PerfDisplay | null;
  /** header.device. */
  readonly device: PerfHeaderLine["device"] | null;
  /** header.gpu. */
  readonly gpu: PerfHeaderLine["gpu"] | null;
  /** header.build: spec 10's build id. */
  readonly build: string | null;
  /** header.engine: spec 10's engine fingerprint. */
  readonly engine: string | null;
};

/**
 * A frame event of the game that a spike record lists under "what changed": a game overlay changing
 * (`label` + `what`), a pool trim (MB freed) or a warm-up run (draws).
 *
 * @example
 * ```ts
 * const opened: PerfFrameEvent = { kind: "overlay", frame: 4812, label: "shopDimLayer", what: "open", mode: "freeze" };
 * const trim: PerfFrameEvent = { kind: "pool-trim", frame: 4811, reason: "rest", freedMb: 41.5 };
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
 * One spike of the window, for lists and MCP.
 *
 * @example
 * ```ts
 * const spike: PerfSpikeSummary = { frame: 4812, agoMs: 980, ms: 41.3, budgetMs: 16.7, overMs: 24.6, cause: "upload",
 *   causes: ["upload", "gap"], jsMs: 8, gpuMs: 6.6, path: "garden/boss", why: "41.0 MB of textures uploaded this frame (bundle garden-boss)" };
 * ```
 */
export type PerfSpikeSummary = {
  readonly frame: number;
  /** ms before the newest frame of the window. */
  readonly agoMs: number;
  readonly ms: number;
  /** The frame's own budget: its `budgetMs` column, the budget the engine's spike rule used for it. */
  readonly budgetMs: number;
  /** ms − budgetMs. */
  readonly overMs: number;
  /** The primary cause by CAUSE_RANK. */
  readonly cause: PerfCause;
  /** Every cause, primary first. */
  readonly causes: readonly PerfCause[];
  readonly jsMs: number;
  readonly gpuMs: number | null;
  /** The flow path of the frame (ring.paths). */
  readonly path: string;
  /** One sentence: why this frame was late. */
  readonly why: string;
};

/**
 * The spike record (design §7): the summary plus the frame's numbers and, once the engine's spike
 * line arrived (about one flush later), its full detail.
 *
 * @example
 * ```ts
 * app.perf.spike(4812)?.rateSwitch; // { from: 120, to: 60, reason: "missed", mode: "auto" }
 * ```
 */
export type PerfSpikeRecord = PerfSpikeSummary & {
  /** Epoch ms of the frame's start (header.timeOrigin + t); null before a header. */
  readonly at: number | null;
  /** The frame's rate in fps (`rateFps(rateMs)`). */
  readonly fps: number;
  /** The rate switch at this frame; `reason` and `mode` from its `rate` event (null when only the rows show it). */
  readonly rateSwitch: {
    readonly from: number;
    readonly to: number;
    readonly reason: RateReason | null;
    readonly mode: RateMode | null;
  } | null;
  readonly gapMs: number | null;
  readonly drawn: boolean;
  /** The GPU time may still change. */
  readonly gpuPartial: boolean;
  /** Phase ms in PHASES order plus agent; null when the ring slot was overwritten and no spike line came. */
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
  /** The game's frame events of this frame (and the `pool-trim` lines of the frame before), in arrival order. */
  readonly events: readonly PerfFrameEvent[];
  /** The engine's spike line; null until it arrives. */
  readonly detail: PerfSpikeLine | null;
};
