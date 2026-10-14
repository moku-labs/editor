/**
 * @file perf/protocol — the frame rate of a row: one frame of a rate (the ring's `rateMs`) turned
 * into frames per second. Runtime-free.
 */

/**
 * Frames per second of one frame of a rate: `Math.round(1000 / rateMs)`.
 *
 * @param rateMs - One frame of the rate, ms (the ring's `rateMs` column).
 * @returns The fps; 0 for a value that is not a finite number above 0 (a ring before `rateMs`, NaN).
 * @example
 * ```ts
 * rateFps(8.33); // 120
 * ```
 */
export function rateFps(rateMs: number): number {
  return Number.isFinite(rateMs) && rateMs > 0 ? Math.round(1000 / rateMs) : 0;
}
