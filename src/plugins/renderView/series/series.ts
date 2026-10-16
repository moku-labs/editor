/**
 * @file renderView series — the side series' allocation and their reset (spec 09 § M11): every
 * column at its full capacity once, in `createRenderViewState`; a source switch empties them without
 * reallocating. `clearSeries` is a typed stub until build wave 3 (unit RV1).
 */
import { HISTORY_MS } from "../source/contract";
import { notBuilt } from "../stub";
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
 * Empties every series without reallocating (a source switch): every count to 0, the one-core
 * readings to null, the overview's start to 0, `version` bumped.
 *
 * @param _series - The series.
 * @throws {Error} Until build wave 3 (RV1): "renderView series/clearSeries is not built yet".
 */
export function clearSeries(_series: MissionSeries): void {
  notBuilt("series/clearSeries", 3);
}
