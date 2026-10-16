/**
 * @file perf/protocol — the frame rate of a row: one frame of a rate (the ring's `rateMs`) turned
 * into frames per second, and the two 60 fps defaults perf and the painter fall back to.
 * Runtime-free.
 */

/**
 * The budget a window with no frame shows, ms: one 60 fps frame as the tape and the pill print it
 * (spec 03: `second().budgetMs` is 16.7 while the window is empty).
 */
export const EMPTY_BUDGET_MS = 16.7;

/**
 * The rate of a row whose ring value is missing and that has no row before it, ms: one 60 fps frame
 * (spec 03 read cycle step 4).
 */
export const DEFAULT_RATE_MS = 16.67;

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
