/**
 * @file gameView plugin — capture/series.ts (skeleton stubs, implemented in its wave).
 */
import type { GameViewCtx, SeriesResult } from "../types";

/**
 * Skeleton stub for `recordSeries`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _options - The options.
 * @param _options.durationMs - The durationMs.
 * @param _options.intervalMs - The intervalMs.
 * @param _options.label - The label.
 * @example
 * ```ts
 * recordSeries();
 * ```
 */
export function recordSeries(
  _ctx: GameViewCtx,
  _options: { readonly durationMs: number; readonly intervalMs: number; readonly label?: string }
): Promise<SeriesResult | undefined> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `stopRecording`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * stopRecording();
 * ```
 */
export function stopRecording(_ctx: GameViewCtx): void {
  throw new Error("not implemented");
}
