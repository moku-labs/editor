/**
 * @file renderView series — the heap and device-load series from a wired phone's telemetry (spec 09
 * § M11, M2 rule 6): records arrive in computer epoch ms and are placed on the source clock with
 * `at + clockOffset − timeOrigin`; without an offset (before two heartbeats) nothing is placed, the
 * cards still read the record. An unavailable reading is a gap (NaN), never 0. Allocation-free.
 */
import type { DeviceTelemetry, ProcessCpu, Reading } from "../source/contract";
import { pushSample } from "./series";
import type { MissionSeries } from "./types";

/**
 * The % of all cores of a CPU reading.
 *
 * @param reading - The process's reading.
 * @returns Its `pct`; NaN when not available.
 */
function pctOf(reading: Reading<ProcessCpu>): number {
  return reading.available ? reading.value.pct : Number.NaN;
}

/**
 * The % of one core of a CPU reading.
 *
 * @param reading - The process's reading.
 * @returns Its `oneCorePct`; null when not available.
 */
function oneCoreOf(reading: Reading<ProcessCpu>): number | null {
  // eslint-disable-next-line unicorn/no-null -- null: no reading
  return reading.available ? reading.value.oneCorePct : null;
}

/**
 * Adds the record's heap samples and GCs (CDP), each once.
 *
 * @param series - The side series.
 * @param record - The record.
 * @param shift - offset − timeOrigin: what turns a computer epoch ms into a source-clock ms.
 */
function addHeap(series: MissionSeries, record: DeviceTelemetry, shift: number): void {
  if (!record.heap.available) return;
  const { samples, gcs } = record.heap.value;
  for (const sample of samples) pushSample(series.heap, sample.t + shift, sample.usedMb);
  const column = series.gcs;
  for (const gc of gcs) {
    if (!pushSample(column, gc.t + shift, gc.freedMb)) continue;
    column.inferred[column.count - 1] = gc.inferred ? 1 : 0;
  }
}

/**
 * Adds the record's load readings at its time: CPU per process as % of all cores, GPU busy and
 * clock, and the newest % of one core for the titles.
 *
 * @param series - The side series.
 * @param record - The record.
 * @param t - Its source-clock ms.
 */
function addLoad(series: MissionSeries, record: DeviceTelemetry, t: number): void {
  const { load } = series;
  const { cpu, gpu } = record;
  if (!pushSample(load.cpuApp, t, pctOf(cpu.app))) return;
  pushSample(load.cpuRenderer, t, pctOf(cpu.renderer));
  pushSample(load.cpuFlinger, t, pctOf(cpu.surfaceflinger));
  pushSample(load.gpuBusy, t, gpu.available ? (gpu.value.busyPct ?? Number.NaN) : Number.NaN);
  pushSample(load.gpuMhz, t, gpu.available ? (gpu.value.mhz ?? Number.NaN) : Number.NaN);
  load.oneCore.app = oneCoreOf(cpu.app);
  load.oneCore.renderer = oneCoreOf(cpu.renderer);
  load.oneCore.flinger = oneCoreOf(cpu.surfaceflinger);
}

/**
 * Adds a record's heap samples, GCs (inferred ones marked) and load readings at `at + offset −
 * timeOrigin`; an unavailable reading is a gap (NaN), never 0; a sample already placed is skipped.
 *
 * @param series - The side series.
 * @param record - A telemetry record of the active device.
 * @param offsetMs - activeSource.clockOffsetMs(): phone epoch − computer epoch; null before two beats.
 * @param timeOrigin - The page's clock origin (the second's epoch as a number); null before it is known.
 * @returns Whether the record was placed on the time axis (false without an offset: the cards still read it).
 * @example
 * ```ts
 * addTelemetry(series, record, app.activeSource.clockOffsetMs(), Number(second.epoch)); // true
 * ```
 */
export function addTelemetry(
  series: MissionSeries,
  record: DeviceTelemetry,
  offsetMs: number | null,
  timeOrigin: number | null
): boolean {
  if (offsetMs === null || timeOrigin === null) return false;
  const shift = offsetMs - timeOrigin;
  addHeap(series, record, shift);
  addLoad(series, record, record.at + shift);
  series.version += 1;
  return true;
}
