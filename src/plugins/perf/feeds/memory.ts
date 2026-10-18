/**
 * @file perf feeds — memory trust (spec 03 Delta 2026-10-16 D6): the frozen-counter count of the
 * sample heap (allocation-free, per sample line) and `second().memory`, the heap with whether to
 * believe it.
 */
import type { PerfMemory } from "../protocol";
import { memoryWhy } from "../protocol";
import type { PerfState, SampleLine } from "../types";

/**
 * Counts equal heap samples (D6): a new value starts a count of 1 (this sample); the same value
 * counts on only while the window had awake frames (a resting page's heap is flat for a reason).
 * `memoryWhy` calls the counter frozen at FROZEN_SAMPLES. Allocation-free.
 *
 * @param state - perf's state.
 * @param sample - The new sample line.
 */
export function noteHeap(state: PerfState, sample: SampleLine): void {
  // eslint-disable-next-line unicorn/no-null -- null is "no heap number", as in the sample
  const heap = Number.isFinite(sample.heapMb) ? sample.heapMb : null;
  if (heap !== state.heapLast) {
    state.heapLast = heap;
    state.heapSame = 1;
  } else if (state.fpsLoop > 0) {
    state.heapSame += 1;
  }
}

/**
 * The page's memory and whether to trust it (D6): the newest sample's heap, its source (the
 * engine's `memory.source` when it says, else `performance.memory` for a heap number), not
 * trusted in a WebView, after FROZEN_SAMPLES equal awake samples, or without a heap number.
 *
 * @param state - perf's state.
 * @returns The memory value (a fresh object).
 */
export function memoryOf(state: PerfState): PerfMemory {
  const { sample, header } = state;
  // eslint-disable-next-line unicorn/no-null -- null is "not a WebView", "no heap", "no shell"
  const none = null;
  const heap = sample?.heapMb;
  const heapMb = typeof heap === "number" && Number.isFinite(heap) ? heap : none;
  const why = memoryWhy(heapMb, header?.device.webview ?? none, state.heapSame);
  const source = heapMb === null ? none : (sample?.memory?.source ?? "performance.memory");
  return {
    heapMb,
    source,
    trusted: why === null,
    why,
    processMb: sample?.memory?.processMb ?? none
  };
}
