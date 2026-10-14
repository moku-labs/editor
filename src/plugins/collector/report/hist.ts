/**
 * @file collector/report — histograms: the fixed 81-bucket frame histogram of a sample
 * (`frameHist`), read with nearest-rank percentiles at the bucket's upper edge, and the
 * millisecond histogram of adb gfxinfo, read with the game's percentile. Pure.
 */
import { PERF_GAP_BUCKETS } from "../../perf/protocol";
import type { HistPercentile } from "./types";

/** The 1 ms buckets: [0,1) … [49,50). */
const FINE_BUCKETS = 50;

/** The upper edge of the first 5 ms bucket, [50,55). */
const FIRST_COARSE_UPPER = 55;

/** The width of a 5 ms bucket. */
const COARSE_WIDTH = 5;

/** The last bucket: 200 ms and over. */
const OVER_INDEX = PERF_GAP_BUCKETS - 1;

/** The edge the last bucket reports. */
const OVER_MS = 200;

/**
 * The upper edge of a `frameHist` bucket: `[0,1)…[49,50)` → index + 1, `[50,55)…[195,200)` →
 * 55 + 5 × (index − 50), index 80 (200 ms and over) → 200.
 *
 * @param index - The bucket, 0–80.
 * @returns Its upper edge in ms.
 * @example
 * ```ts
 * bucketUpper(51); // 60
 * ```
 */
export function bucketUpper(index: number): number {
  if (index < FINE_BUCKETS) return index + 1;
  if (index < OVER_INDEX) return FIRST_COARSE_UPPER + COARSE_WIDTH * (index - FINE_BUCKETS);

  return OVER_MS;
}

/**
 * A nearest-rank percentile of a fixed-bucket histogram: `rank = ceil(share × total)`, the first
 * bucket whose running count reaches it, read at its upper edge. "Exact": it reads the merged
 * histogram, never an average of per-second percentiles.
 *
 * @param hist - Counts by bucket (81 of them for a `frameHist`).
 * @param share - The share, 0–1 (0.9 for p90).
 * @returns The percentile, `over` for the 200 ms+ bucket; null for an empty histogram.
 * @example
 * ```ts
 * histPercentile([0, 9, 1], 0.9); // { ms: 2, over: false }
 * ```
 */
export function histPercentile(hist: ArrayLike<number>, share: number): HistPercentile | null {
  // An ArrayLike (a typed array or a plain one) is not always iterable: copy it by index.
  const counts = Array.from(hist, count => count);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const rank = Math.max(1, Math.ceil(share * total));
  let seen = 0;
  for (const [index, count] of counts.entries()) {
    seen += count;
    if (seen >= rank) return { ms: bucketUpper(index), over: index >= OVER_INDEX };
  }

  // eslint-disable-next-line unicorn/no-null -- null is "no frames" on ScreenSummary's percentiles
  return null;
}

/**
 * The game's percentile of a millisecond histogram (adb gfxinfo): sorted by ms, the first bucket
 * whose running count reaches `total × share`.
 *
 * @param hist - `[milliseconds, count]` pairs, in any order.
 * @param share - The share, 0–1.
 * @returns The frame time in ms; 0 for no frames.
 * @example
 * ```ts
 * gfxPercentile([[16, 90], [40, 10]], 0.95); // 40
 * ```
 */
export function gfxPercentile(hist: readonly (readonly [number, number])[], share: number): number {
  const sorted = hist.toSorted((one, other) => one[0] - other[0]);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);
  let seen = 0;
  for (const [ms, count] of sorted) {
    seen += count;
    if (seen >= total * share && count > 0) return ms;
  }

  return 0;
}
