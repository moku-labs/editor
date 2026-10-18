/**
 * @file collector plugin — one clock for a log: the page-clock offset (`max(t − rx)` over the
 * device's lines, the line with the least delay) and the page-clock `t` of a line the collector
 * writes. Pure.
 */

/**
 * The offset of a log after one more device line: the max of `t − rx`. A line without a finite
 * `t` leaves it as it was.
 *
 * @param offset - The offset so far, null before the first line with a t.
 * @param t - The line's page t, read defensively.
 * @param rx - Computer epoch ms when its batch arrived.
 * @returns The new offset.
 * @example
 * ```ts
 * offsetWith(-48_900, 1000, 50_000); // -48900: the earlier line had less delay
 * ```
 */
export function offsetWith(offset: number | null, t: unknown, rx: number): number | null {
  if (typeof t !== "number" || !Number.isFinite(t)) return offset;

  const estimate = t - rx;
  return offset === null || estimate > offset ? estimate : offset;
}

/**
 * A computer moment on a log's page clock, rounded to 0.01 ms. A log whose offset is still unknown
 * keeps the computer moment.
 *
 * @param offset - The log's offset.
 * @param now - Computer epoch ms.
 * @returns The page t.
 * @example
 * ```ts
 * pageTime(-1_791_986_084_082.6, 1_791_986_100_000); // 15917.4
 * ```
 */
export function pageTime(offset: number | null, now: number): number {
  return Math.round((now + (offset ?? 0)) * 100) / 100;
}
