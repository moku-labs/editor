/**
 * @file renderView series — the types of Mission control's side series (spec 09 § M11): the overview
 * buckets over the 2-minute history and the time series the cards chart beside perf's history
 * (heap and GCs, textures, object counters, device load). Each is allocated once by
 * `createMissionSeries` and trimmed to the same 2 minutes on the source clock; `clearSeries` sets
 * every count to 0 without reallocating.
 */
import type { PerfCause } from "../source/contract";

/**
 * One value over time, oldest first, allocated once: `t` source-clock ms, `v` the value (NaN: a gap,
 * a reading that was not available, never 0).
 *
 * @example
 * ```ts
 * const textures: SeriesColumn = { t: new Float64Array(128), v: new Float32Array(128), count: 0 };
 * ```
 */
export type SeriesColumn = { readonly t: Float64Array; readonly v: Float32Array; count: number };

/**
 * GC marks over time: `v` the MB freed, `inferred` 1 for a GC inferred from a heap drop (drawn
 * hollow), 0 for an exact one.
 *
 * @example
 * ```ts
 * const gcs: GcColumn = { t: new Float64Array(256), v: new Float32Array(256), inferred: new Uint8Array(256), count: 0 };
 * ```
 */
export type GcColumn = SeriesColumn & { readonly inferred: Uint8Array };

/**
 * The overview strip: 500 ms buckets over the 2-minute history, updated from each appended batch of
 * rows, never recomputed per paint. `flags` holds OVERVIEW_FLAGS bits; `cause` the primary spike
 * cause code of the bucket (CAUSE_RANK order + 1, 0 = no spike).
 *
 * @example
 * ```ts
 * const overview: OverviewBuckets = { start: 0, count: 0, max: new Float32Array(240), flags: new Uint8Array(240), cause: new Uint8Array(240) };
 * ```
 */
export type OverviewBuckets = {
  /** Source-clock ms of bucket 0's start. */
  start: number;
  /** Buckets in use, oldest first. */
  count: number;
  /** The worst frame ms of each bucket; NaN: no frame. */
  readonly max: Float32Array;
  /** OVERVIEW_FLAGS bits of each bucket: rested, spike, GC, rate change. */
  readonly flags: Uint8Array;
  /** The primary spike cause code of each bucket; 0: none. */
  readonly cause: Uint8Array;
};

/**
 * The object counters of `sample.counts` (engine U3) and the render targets created (`sample.targets`),
 * one sample a second.
 *
 * @example
 * ```ts
 * const objects: ObjectSeries = createMissionSeries().objects;
 * ```
 */
export type ObjectSeries = {
  readonly entities: SeriesColumn;
  readonly views: SeriesColumn;
  readonly timers: SeriesColumn;
  readonly frameListeners: SeriesColumn;
  readonly inputListeners: SeriesColumn;
  readonly targets: SeriesColumn;
};

/**
 * Device load of a wired phone (spec 11 § 0.4), one sample a second: CPU per process as % of all
 * cores (stacked by the card), GPU busy and clock, and the newest % of one core for the titles.
 *
 * @example
 * ```ts
 * const load: LoadSeries = createMissionSeries().load;
 * ```
 */
export type LoadSeries = {
  readonly cpuApp: SeriesColumn;
  readonly cpuRenderer: SeriesColumn;
  readonly cpuFlinger: SeriesColumn;
  readonly gpuBusy: SeriesColumn;
  readonly gpuMhz: SeriesColumn;
  /** The newest % of one core per process; null before a reading. */
  oneCore: { app: number | null; renderer: number | null; flinger: number | null };
};

/**
 * renderView's own side series of the active source (spec 09 § M11), allocated once.
 *
 * @example
 * ```ts
 * const series: MissionSeries = createMissionSeries();
 * series.heap.count; // 0
 * ```
 */
export type MissionSeries = {
  readonly overview: OverviewBuckets;
  /** The heap, MB: CDP samples at 4 Hz on a wired phone, or the local preview's trusted heap at 1 Hz. */
  readonly heap: SeriesColumn;
  /** GCs: inferred from CDP heap drops on a wired phone, or the engine's `gc` events. */
  readonly gcs: GcColumn;
  /** Texture MB of `second.sample.textures`, 1 Hz. */
  readonly textures: SeriesColumn;
  readonly objects: ObjectSeries;
  readonly load: LoadSeries;
  /** Bumped on every change: the cards key on it. */
  version: number;
};

/**
 * A spike group: consecutive frames of one primary cause (spec 09 § M8 item 7), with its rows,
 * its cause and its worst frame.
 *
 * @example
 * ```ts
 * const group: SpikeGroup = { from: 4851, to: 4853, cause: "compile", maxMs: 41.3, firstRow: 365, lastRow: 367 };
 * ```
 */
export type SpikeGroup = {
  readonly from: number;
  readonly to: number;
  readonly cause: PerfCause;
  readonly maxMs: number;
  readonly firstRow: number;
  readonly lastRow: number;
};
