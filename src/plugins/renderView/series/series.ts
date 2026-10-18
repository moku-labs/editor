/**
 * @file renderView series — the side series' allocation, their one write and their reset (spec 09 §
 * M11): every column at its full capacity once, in `createRenderViewState`; `pushSample` appends one
 * sample in time order and keeps the same two minutes as perf's history; a source switch empties
 * them without reallocating.
 */
import { HISTORY_MS } from "../source/contract";
import type { GcColumn, MissionSeries, SeriesColumn } from "./types";

/** The overview's bucket, ms (spec 09 § M12). */
export const OVERVIEW_BUCKET_MS = 500;

/** Buckets over the 2-minute history: 240. */
export const OVERVIEW_BUCKETS = HISTORY_MS / OVERVIEW_BUCKET_MS;

/** The bits of `OverviewBuckets.flags`. */
export const OVERVIEW_FLAGS = { rested: 1, spike: 2, gc: 4, rate: 8 } as const;

/** Heap samples kept: 4 Hz × 120 s, with room. */
export const HEAP_SAMPLES = 512;

/** GC marks kept. */
export const GC_MARKS = 256;

/** Samples of a 1 Hz series kept: 120 s, with room. */
export const SECOND_SAMPLES = 128;

/**
 * An empty time series of a capacity.
 *
 * @param capacity - Samples it holds at most.
 * @returns The column.
 */
function columnOf(capacity: number): SeriesColumn {
  return { t: new Float64Array(capacity), v: new Float32Array(capacity), count: 0 };
}

/**
 * An empty GC column.
 *
 * @returns The column.
 */
function gcColumn(): GcColumn {
  return { ...columnOf(GC_MARKS), inferred: new Uint8Array(GC_MARKS) };
}

/**
 * Allocates the side series of Mission control, empty, every column at its full capacity once.
 *
 * @returns The series.
 * @example
 * ```ts
 * const series = createMissionSeries();
 * series.overview.max.length; // 240
 * series.heap.count; // 0
 * ```
 */
export function createMissionSeries(): MissionSeries {
  return {
    overview: {
      start: 0,
      count: 0,
      max: new Float32Array(OVERVIEW_BUCKETS),
      flags: new Uint8Array(OVERVIEW_BUCKETS),
      cause: new Uint8Array(OVERVIEW_BUCKETS)
    },
    heap: columnOf(HEAP_SAMPLES),
    gcs: gcColumn(),
    textures: columnOf(SECOND_SAMPLES),
    objects: {
      entities: columnOf(SECOND_SAMPLES),
      views: columnOf(SECOND_SAMPLES),
      timers: columnOf(SECOND_SAMPLES),
      frameListeners: columnOf(SECOND_SAMPLES),
      inputListeners: columnOf(SECOND_SAMPLES),
      targets: columnOf(SECOND_SAMPLES)
    },
    load: {
      cpuApp: columnOf(SECOND_SAMPLES),
      cpuRenderer: columnOf(SECOND_SAMPLES),
      cpuFlinger: columnOf(SECOND_SAMPLES),
      gpuBusy: columnOf(SECOND_SAMPLES),
      gpuMhz: columnOf(SECOND_SAMPLES),
      // eslint-disable-next-line unicorn/no-null -- null: no reading yet
      oneCore: { app: null, renderer: null, flinger: null }
    },
    version: 0
  };
}

/**
 * Drops the first `drop` samples of a column (the oldest), moving the rest to the front.
 *
 * @param column - The column.
 * @param drop - Samples to drop.
 */
export function shiftColumn(column: SeriesColumn, drop: number): void {
  if (drop <= 0) return;
  const kept = Math.max(0, column.count - drop);
  column.t.copyWithin(0, drop, column.count);
  column.v.copyWithin(0, drop, column.count);
  column.count = kept;
}

/**
 * The samples at the start of a column older than `cut`.
 *
 * @param column - The column.
 * @param cut - The oldest time kept, source-clock ms.
 * @returns How many to drop.
 */
function olderThan(column: SeriesColumn, cut: number): number {
  let index = 0;
  while (index < column.count && (column.t[index] ?? 0) < cut) index += 1;
  return index;
}

/**
 * Appends one sample in time order: a sample at or before the newest is skipped (the same reading
 * again), samples older than two minutes before it drop, and a full column drops its oldest. A gap
 * is NaN, never 0. Allocation-free.
 *
 * @param column - The column.
 * @param t - Source-clock ms of the sample.
 * @param v - Its value; NaN for a reading that was not available.
 * @returns Whether it was added.
 * @example
 * ```ts
 * pushSample(series.textures, 46_000, 130); // true; the same time again: false
 * ```
 */
export function pushSample(column: SeriesColumn, t: number, v: number): boolean {
  if (column.count > 0 && t <= (column.t[column.count - 1] ?? 0)) return false;
  shiftColumn(
    column,
    Math.max(olderThan(column, t - HISTORY_MS), column.count + 1 - column.t.length)
  );
  column.t[column.count] = t;
  column.v[column.count] = v;
  column.count += 1;
  return true;
}

/**
 * Empties every series without reallocating (a source switch): every count to 0, the one-core
 * readings to null, the overview's start to 0, `version` bumped.
 *
 * @param series - The series.
 * @example
 * ```ts
 * clearSeries(series);
 * series.heap.count; // 0, the same 512-sample arrays kept
 * ```
 */
export function clearSeries(series: MissionSeries): void {
  const { overview, objects, load } = series;
  overview.start = 0;
  overview.count = 0;
  series.heap.count = 0;
  series.gcs.count = 0;
  series.textures.count = 0;
  objects.entities.count = 0;
  objects.views.count = 0;
  objects.timers.count = 0;
  objects.frameListeners.count = 0;
  objects.inputListeners.count = 0;
  objects.targets.count = 0;
  load.cpuApp.count = 0;
  load.cpuRenderer.count = 0;
  load.cpuFlinger.count = 0;
  load.gpuBusy.count = 0;
  load.gpuMhz.count = 0;
  // eslint-disable-next-line unicorn/no-null -- null: no reading yet
  const none = null;
  load.oneCore.app = none;
  load.oneCore.renderer = none;
  load.oneCore.flinger = none;
  series.version += 1;
}
