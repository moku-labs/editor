/**
 * @file perf feeds — the small readers every feed's wire value shares: a column cell, the wire's
 * rounding (`NaN` → null, never 0) and the page's epoch.
 */
import type { PerfState } from "../types";

/** Wire rounding: page-clock times to tenths of a ms. */
export const TIME_SCALE = 10;

/** Wire rounding: every other ms value to hundredths. */
export const MS_SCALE = 100;

/**
 * One value of a column; NaN past its end (`noUncheckedIndexedAccess` reads a typed array as
 * possibly undefined).
 *
 * @param column - The column.
 * @param index - The index.
 * @returns The value, or NaN.
 * @example
 * ```ts
 * cell(Float32Array.of(16.5), 1); // NaN
 * ```
 */
export function cell(column: ArrayLike<number>, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * A number rounded to `scale` steps; null for one that is not finite ("not measured").
 *
 * @param value - The number, or none.
 * @param scale - Steps per unit (100: 0.01).
 * @returns The rounded number, or null.
 * @example
 * ```ts
 * measured(16.666_666, MS_SCALE); // 16.67
 * measured(Number.NaN, MS_SCALE); // null
 * ```
 */
export function measured(value: number | null | undefined, scale: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    // eslint-disable-next-line unicorn/no-null -- null is "not measured" on the wire
    return null;
  }
  return Math.round(value * scale) / scale;
}

/**
 * A number rounded to `scale` steps; 0 for one that is not finite (columns that are always
 * measured).
 *
 * @param value - The number.
 * @param scale - Steps per unit.
 * @returns The rounded number.
 * @example
 * ```ts
 * rounded(80_310.249, TIME_SCALE); // 80310.2
 * ```
 */
export function rounded(value: number, scale: number): number {
  return measured(value, scale) ?? 0;
}

/**
 * The page's clock origin as text (`header.timeOrigin`): a new value is a new page (reload).
 *
 * @param state - perf's state.
 * @returns The epoch; null before a header.
 */
export function epochOf(state: PerfState): string | null {
  // eslint-disable-next-line unicorn/no-null -- null is "no header yet"
  return state.header === undefined ? null : String(state.header.timeOrigin);
}
