/**
 * @file perf/protocol — the GPU noise rule (spec 03 delta item 8; engine diagnosis 2026-10-15: one
 * frame's `gpuMs` is noisy on Apple and Mali, 17–25 ms readings at a 0.49 ms p50): a GPU over its
 * frame's budget counts only when it is sustained, on 2 of 3 consecutive drawn frames; a lone
 * outlier stays in the window's `noise` column, a faint GPU tick. Also the window's GPU p50 and p90,
 * the headline GPU. Allocation-free. Runtime-free.
 */
import { CAUSE_BITS, spikeCause } from "./causes";
import type { PerfWindow, PerfWindowView } from "./window";

/**
 * The `causes` bit of a GPU over the frame's budget (the engine sets it when the late GPU result
 * lands over `budgetMs`).
 *
 * @example
 * ```ts
 * app.perf.readWindow(window => (window.noise?.[row] ?? 0) & GPU_BIT); // 4: a faint GPU tick
 * ```
 */
export const GPU_BIT = 1 << CAUSE_BITS.indexOf("gpu");

/** The headline's percentiles of the GPU time. */
const P50 = 0.5;
const P90 = 0.9;

/**
 * One value of a column; NaN past its end.
 *
 * @param column - The column.
 * @param index - The index.
 * @returns The value, or NaN.
 * @example
 * ```ts
 * cell(Float32Array.of(0.49), 0); // 0.49
 * ```
 */
function cell(column: ArrayLike<number>, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * Whether a row's GPU was a lone outlier: over its budget, not sustained, so not counted (the faint
 * GPU tick of the graph). False for a window without the `noise` column (an agent before item 8).
 *
 * @param window - The window.
 * @param row - A row.
 * @returns Whether the row's GPU is noise.
 * @example
 * ```ts
 * isGpuNoise(window, 290); // true: 22 ms on one frame, 0.5 ms around it
 * ```
 */
export function isGpuNoise(window: PerfWindowView, row: number): boolean {
  return ((window.noise?.[row] ?? 0) & GPU_BIT) !== 0;
}

/**
 * Whether a row has a GPU over its budget, counted or not.
 *
 * @param window - The window.
 * @param row - A row.
 * @returns Whether its GPU was over budget.
 */
function isGpuOver(window: PerfWindow, row: number): boolean {
  return ((cell(window.causes, row) | cell(window.noise, row)) & GPU_BIT) !== 0;
}

/**
 * Counts a row's over-budget GPU: the gpu bit moves from `noise` to `causes`, and the cause is
 * decided again.
 *
 * @param window - The window.
 * @param row - A row with an over-budget GPU.
 * @returns Whether the row changed (false for a GPU already counted).
 */
function countGpu(window: PerfWindow, row: number): boolean {
  if ((cell(window.noise, row) & GPU_BIT) === 0) return false;
  const causes = cell(window.causes, row) | GPU_BIT;
  window.noise[row] = cell(window.noise, row) & ~GPU_BIT;
  window.causes[row] = causes;
  window.cause[row] = spikeCause(causes, cell(window.rest, row));
  return true;
}

/**
 * Counts the GPU of a row and of an earlier drawn row when both were over budget.
 *
 * @param window - The window.
 * @param row - A row whose GPU was over budget.
 * @param partner - An earlier drawn row; -1 for none.
 * @returns Whether a row changed.
 */
function countPair(window: PerfWindow, row: number, partner: number): boolean {
  if (partner < 0 || !isGpuOver(window, partner)) return false;
  const rowChanged = countGpu(window, row);
  const partnerChanged = countGpu(window, partner);
  return rowChanged || partnerChanged;
}

/**
 * Counts every sustained GPU of the window: a GPU over budget on 2 of 3 consecutive drawn frames
 * (frames not drawn are skipped), both frames. A row's GPU is never uncounted again, so a spike
 * stays a spike after its partner left the window. Run after the late GPU results landed, so the
 * second over-budget result promotes the first. Allocation-free: one pass, two row indices.
 *
 * @param window - The window; rows with an uncounted GPU hold it in `noise`.
 * @returns Whether a row changed.
 * @example
 * ```ts
 * promoteSustainedGpu(window); // true: rows 40 and 42 both 20 ms, both now gpu spikes
 * ```
 */
export function promoteSustainedGpu(window: PerfWindow): boolean {
  let changed = false;
  // The two drawn rows before `row`, newest first; -1 for none. Two over-budget GPU frames at most
  // two drawn frames apart lie in one run of 3 consecutive drawn frames: 2 of 3.
  let previous = -1;
  let before = -1;
  for (let row = 0; row < window.count; row += 1) {
    if (window.drawn[row] !== 1) continue;
    if (isGpuOver(window, row)) {
      if (countPair(window, row, previous)) changed = true;
      if (countPair(window, row, before)) changed = true;
    }
    before = previous;
    previous = row;
  }
  return changed;
}

/**
 * The value at a nearest-rank percentile of the first `count` sorted values.
 *
 * @param sorted - Ascending values.
 * @param count - Values in use.
 * @param fraction - The percentile, 0..1.
 * @returns The value; NaN without values.
 * @example
 * ```ts
 * rankOf(Float64Array.of(1, 2, 3, 4), 4, 0.5); // 2
 * ```
 */
function rankOf(sorted: Float64Array, count: number, fraction: number): number {
  return count === 0 ? Number.NaN : cell(sorted, Math.ceil(count * fraction) - 1);
}

/**
 * Writes the window's headline GPU: the p50 and p90 (nearest rank) of the GPU times of its drawn
 * frames with a measured GPU, NaN without one (no GPU timer). Allocation-free: sorts `sorted` in
 * place, its unused tail filled with +Infinity.
 *
 * @param window - The window.
 * @param sorted - A scratch of at least `window.count` values.
 * @example
 * ```ts
 * spreadGpu(window, scratch);
 * window.gpuP50Ms; // 0.49
 * window.gpuP90Ms; // 0.61: one 22 ms outlier moves neither
 * ```
 */
export function spreadGpu(window: PerfWindow, sorted: Float64Array): void {
  let count = 0;
  for (let row = 0; row < window.count; row += 1) {
    const gpuMs = cell(window.gpuMs, row);
    if (window.drawn[row] !== 1 || !Number.isFinite(gpuMs)) continue;
    sorted[count] = gpuMs;
    count += 1;
  }
  sorted.fill(Number.POSITIVE_INFINITY, count);
  sorted.sort();
  window.gpuP50Ms = rankOf(sorted, count, P50);
  window.gpuP90Ms = rankOf(sorted, count, P90);
}
