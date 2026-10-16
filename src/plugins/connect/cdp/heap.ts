/**
 * @file connect plugin — the exact JS heap of a wired phone's WebView over CDP (spec 11 § 0.4, C6):
 * the sampler (`Runtime.getHeapUsage` every `heapEveryMs`, never two at once), the tick's take of
 * the samples since the tick before, and the pure GC inference: a drop of `usedSize` of at least
 * `gcDropMb` between two samples is a GC freeing the drop (labelled inferred; minor GCs below it
 * are not seen).
 */

import { roundTenth } from "../telemetry/cpu";
import type { AttachRecord, DeviceTelemetry, HeapGc, HeapSample } from "../types";

/** Bytes in a MB. */
const BYTES_PER_MB = 1_048_576;

/** The most samples kept between two ticks (a tick that is late does not grow them forever). */
const MAX_SAMPLES = 64;

/** The source of the heap reading. */
export const HEAP_SOURCE = "cdp Runtime.getHeapUsage";

/**
 * The GCs inferred from a run of samples: every drop of usedMb of at least `dropMb` between two
 * samples, at the time of the lower one. A rise never is one.
 *
 * @param samples - The samples, oldest first.
 * @param dropMb - The smallest drop that counts.
 * @param before - The last sample before them (a GC across two ticks), if any.
 * @returns The GCs, oldest first.
 * @example
 * ```ts
 * inferGcs([{ t: 1000, usedMb: 27, totalMb: 64 }, { t: 1250, usedMb: 57, totalMb: 64 }, { t: 1500, usedMb: 31, totalMb: 64 }], 0.5); // [{ t: 1500, freedMb: 26, inferred: true }]
 * ```
 */
export function inferGcs(
  samples: readonly HeapSample[],
  dropMb: number,
  before?: HeapSample
): HeapGc[] {
  const gcs: HeapGc[] = [];
  let last = before;
  for (const sample of samples) {
    if (last !== undefined && last.usedMb - sample.usedMb >= dropMb) {
      gcs.push({ t: sample.t, freedMb: roundTenth(last.usedMb - sample.usedMb), inferred: true });
    }
    last = sample;
  }
  return gcs;
}

/**
 * A heap sample from the result of `Runtime.getHeapUsage` (bytes), in MB.
 *
 * @param result - The CDP result.
 * @param t - Epoch ms of the sample.
 * @returns The sample, or undefined for another shape.
 * @example
 * ```ts
 * heapSampleOf({ usedSize: 43935334, totalSize: 67108864 }, 1791986083713); // { t: 1791986083713, usedMb: 41.9, totalMb: 64 }
 * ```
 */
export function heapSampleOf(result: unknown, t: number): HeapSample | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const used = "usedSize" in result ? result.usedSize : undefined;
  const total = "totalSize" in result ? result.totalSize : undefined;
  if (typeof used !== "number" || typeof total !== "number") return undefined;
  if (!Number.isFinite(used) || !Number.isFinite(total)) return undefined;
  return { t, usedMb: roundTenth(used / BYTES_PER_MB), totalMb: roundTenth(total / BYTES_PER_MB) };
}

/**
 * Takes one heap sample over the attach's CDP link; skipped while one is in flight or without a
 * link. A failed sample is skipped.
 *
 * @param attach - The attach.
 * @returns When the sample is kept or skipped.
 */
export async function sampleHeap(attach: AttachRecord): Promise<void> {
  const link = attach.cdp;
  if (link === undefined || attach.heap.pending || attach.ended) return;

  attach.heap.pending = true;
  try {
    const sample = heapSampleOf(await link.client.send("Runtime.getHeapUsage"), Date.now());
    if (sample !== undefined && attach.cdp === link) {
      attach.heap.samples.push(sample);
      if (attach.heap.samples.length > MAX_SAMPLES) attach.heap.samples.shift();
    }
  } catch {
    // A sample that failed (the socket closed, the page navigated) is skipped.
  } finally {
    attach.heap.pending = false;
  }
}

/**
 * The tick's heap reading: the samples since the tick before and the GCs inferred from them, or
 * not available with the reason when there is no CDP link.
 *
 * @param attach - The attach.
 * @param dropMb - The smallest drop that is a GC.
 * @returns The reading; the samples are handed over (the next tick starts empty).
 */
export function takeHeap(attach: AttachRecord, dropMb: number): DeviceTelemetry["heap"] {
  const { heap } = attach;
  if (attach.cdp === undefined) {
    heap.samples = [];
    heap.before = undefined;
    return { available: false, source: "none", reason: heap.off };
  }

  const samples = heap.samples;
  const gcs = inferGcs(samples, dropMb, heap.before);
  heap.before = samples.at(-1) ?? heap.before;
  heap.samples = [];
  return { available: true, source: HEAP_SOURCE, value: { samples, gcs } };
}
