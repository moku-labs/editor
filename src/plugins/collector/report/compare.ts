/* eslint-disable unicorn/no-null -- null is "missing on one side" on a Delta */
/**
 * @file collector/report — `compare`: the A/B comparison of two log summaries by screen and rate.
 * Every compared metric is "lower is better", so ▲ marks a change for the worse. Pure.
 */
import type { CompareRow, Comparison, Delta, LogSummary, ScreenSummary } from "./types";

/**
 * The change in percent of A from which a metric gets an arrow: ▲ at +10 % or more, ▼ at −10 % or
 * less.
 */
export const COMPARE_THRESHOLD = 10;

/** A screen at a rate and its row in each log. */
type Pair = {
  readonly path: string;
  readonly rate: number | null;
  a: ScreenSummary | undefined;
  b: ScreenSummary | undefined;
};

/**
 * The arrow of a change in percent.
 *
 * @param pct - The change, whole percent.
 * @returns ▲, ▼ or null inside the threshold.
 * @example
 * ```ts
 * arrowOf(-28); // "▼"
 * ```
 */
function arrowOf(pct: number): Delta["arrow"] {
  if (pct >= COMPARE_THRESHOLD) return "▲";
  if (pct <= -COMPARE_THRESHOLD) return "▼";

  return null;
}

/**
 * Compares one metric: `pct = (b − a) / a × 100` rounded to whole percent; null when either side
 * is missing or `a` is 0; ▲ also when `a` is 0 and `b > 0`.
 *
 * @param a - Log A's value.
 * @param b - Log B's value.
 * @returns The delta.
 * @example
 * ```ts
 * deltaOf(18, 13); // { a: 18, b: 13, pct: -28, arrow: "▼" }
 * ```
 */
function deltaOf(a: number | null, b: number | null): Delta {
  if (a === null || b === null) return { a, b, pct: null, arrow: null };
  if (a === 0) return { a, b, pct: null, arrow: b > 0 ? "▲" : null };

  const pct = Math.round(((b - a) * 100) / a);
  return { a, b, pct, arrow: arrowOf(pct) };
}

/**
 * The row of a pair.
 *
 * @param pair - A screen at a rate and its rows.
 * @returns The compared row.
 */
function rowOf(pair: Pair): CompareRow {
  const { a, b } = pair;
  const p90 = deltaOf(a?.p90?.ms ?? null, b?.p90?.ms ?? null);
  const p99 = deltaOf(a?.p99?.ms ?? null, b?.p99?.ms ?? null);
  const spikesPerMin = deltaOf(a?.spikesPerMin ?? null, b?.spikesPerMin ?? null);
  const gpuMs = deltaOf(a?.gpuMs ?? null, b?.gpuMs ?? null);
  const named = [
    ["p90", p90],
    ["p99", p99],
    ["spikes", spikesPerMin],
    ["gpu", gpuMs]
  ] as const;

  return {
    path: pair.path,
    rate: pair.rate,
    p90,
    p99,
    spikesPerMin,
    gpuMs,
    worse: named.filter(([, delta]) => delta.arrow === "▲").map(([name]) => name)
  };
}

/**
 * Pair order: by path, then rate from high to low (an unknown rate last).
 *
 * @param one - A pair.
 * @param other - Another pair.
 * @returns The sort order.
 * @example
 * ```ts
 * pairOrder({ path: "a", rate: 60 }, { path: "a", rate: 120 }); // 60
 * ```
 */
function pairOrder(one: Pair, other: Pair): number {
  if (one.path !== other.path) return one.path < other.path ? -1 : 1;

  return (other.rate ?? -1) - (one.rate ?? -1);
}

/**
 * Compares two log summaries: one row for every screen and rate of either log, sorted by path,
 * then rate from high to low. A screen at a rate missing on one side has null values and no
 * arrow, so a log forced to 120 compared with one at 60 gives two half-empty rows, never a false ▲.
 * Spikes are compared per minute, so logs of different length compare fairly.
 *
 * @param a - Log A's summary (the baseline).
 * @param b - Log B's summary.
 * @returns The rows and both summaries.
 * @example
 * ```ts
 * compare(summarize(parsePerfLog(before)), summarize(parsePerfLog(after))).rows[0]?.worse; // ["p99", "gpu"]
 * ```
 */
export function compare(a: LogSummary, b: LogSummary): Comparison {
  const pairs = new Map<string, Pair>();
  const pairOf = (screen: ScreenSummary): Pair => {
    const key = `${screen.path}@${screen.rate ?? "-"}`;
    const pair = pairs.get(key) ?? {
      path: screen.path,
      rate: screen.rate,
      a: undefined,
      b: undefined
    };
    pairs.set(key, pair);
    return pair;
  };
  for (const screen of a.screens) pairOf(screen).a = screen;
  for (const screen of b.screens) pairOf(screen).b = screen;

  return { rows: [...pairs.values()].toSorted(pairOrder).map(pair => rowOf(pair)), a, b };
}
