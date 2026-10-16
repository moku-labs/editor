/**
 * @file renderView series — the 1 Hz series of the active source's second (spec 09 § M11): textures
 * MB, the object counters of `sample.counts` (engine U3) and the render targets created
 * (`sample.targets`), and the local preview's heap when the page trusts it (spec 03 D6: never a
 * WebView's). Allocation-free.
 */
import type { PerfSampleLine, PerfSecond } from "../source/contract";
import { pushSample } from "./series";
import type { MissionSeries } from "./types";

/**
 * The render targets the sample says were created (the 0.15.x patch's `sample.targets`, which the
 * installed engine's sample type does not list yet): read as a field of a newer engine.
 *
 * @param sample - The sample line.
 * @returns Targets created in its second; NaN when the engine does not send them.
 */
function targetsCreated(sample: PerfSampleLine): number {
  const targets: unknown = Reflect.get(sample, "targets");
  if (typeof targets !== "object" || targets === null) return Number.NaN;
  const created: unknown = Reflect.get(targets, "created");
  return typeof created === "number" ? created : Number.NaN;
}

/**
 * A counter of `second.counts`, NaN when the engine does not send it.
 *
 * @param counts - The second's counts, or null.
 * @param name - The counter.
 * @returns Its value.
 */
function countOf(counts: PerfSecond["counts"], name: string): number {
  const value = counts?.[name];
  return typeof value === "number" ? value : Number.NaN;
}

/**
 * Adds one second's textures MB, object counters and targets created, and the heap when `heap` is
 * asked and the page trusts its own (`second.memory.trusted`). A second without a sample adds
 * nothing.
 *
 * @param series - The side series.
 * @param second - The newest `editor.perf.second`.
 * @param t - Source-clock ms of the second's sample.
 * @param heap - The heap may come from the second (the local preview; a device's comes from
 *   telemetry).
 * @example
 * ```ts
 * addSecond(series, second, 46_000, source.kind !== "device");
 * series.textures.v[series.textures.count - 1]; // 130
 * ```
 */
export function addSecond(
  series: MissionSeries,
  second: PerfSecond,
  t: number,
  heap: boolean
): void {
  const { sample, memory } = second;
  if (sample === null) return;
  const { objects } = series;
  const counts = second.counts;
  pushSample(series.textures, t, sample.textures?.mb ?? Number.NaN);
  pushSample(objects.entities, t, countOf(counts, "entities"));
  pushSample(objects.views, t, countOf(counts, "views"));
  pushSample(objects.timers, t, countOf(counts, "timers"));
  pushSample(objects.frameListeners, t, countOf(counts, "frameListeners"));
  pushSample(objects.inputListeners, t, countOf(counts, "inputListeners"));
  pushSample(objects.targets, t, targetsCreated(sample));
  if (heap && memory?.trusted === true && memory.heapMb !== null) {
    pushSample(series.heap, t, memory.heapMb);
  }
  series.version += 1;
}
