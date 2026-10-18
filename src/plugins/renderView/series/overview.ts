/**
 * @file renderView series — the overview's 500 ms buckets (spec 09 § M11): the rows each
 * appendFrames added and the events each appendEvents added are folded in once, never recomputed per
 * paint. A bucket keeps its worst frame (the worst awake frame once it has one), whether it only
 * rested, its primary spike cause and whether a GC or a rate change fell in it. Past two minutes the
 * oldest buckets scroll out. Allocation-free.
 */
import type { PerfHistory } from "../source/contract";
import { REST, spikeCause } from "../source/contract";
import { OVERVIEW_BUCKET_MS, OVERVIEW_BUCKETS, OVERVIEW_FLAGS } from "./series";
import type { MissionSeries, OverviewBuckets } from "./types";

/**
 * Empties buckets `from` to `to` (exclusive): no frame, no flag, no cause.
 *
 * @param overview - The buckets.
 * @param from - The first bucket.
 * @param to - The bucket after the last.
 */
function emptyBuckets(overview: OverviewBuckets, from: number, to: number): void {
  overview.max.fill(Number.NaN, from, to);
  overview.flags.fill(0, from, to);
  overview.cause.fill(0, from, to);
}

/**
 * Scrolls the oldest buckets out: the rest move to the front and the start moves on.
 *
 * @param overview - The buckets.
 * @param drop - Buckets to drop.
 */
function scrollBuckets(overview: OverviewBuckets, drop: number): void {
  const kept = Math.max(0, overview.count - drop);
  overview.max.copyWithin(0, drop, overview.count);
  overview.flags.copyWithin(0, drop, overview.count);
  overview.cause.copyWithin(0, drop, overview.count);
  overview.start += drop * OVERVIEW_BUCKET_MS;
  overview.count = kept;
}

/**
 * The bucket of a time, scrolling and growing the buckets to hold it.
 *
 * @param overview - The buckets.
 * @param t - Source-clock ms.
 * @returns The bucket; −1 for a time before the oldest bucket.
 * @example
 * ```ts
 * bucketOf(series.overview, 80_310.2); // 239 while it is the newest
 * ```
 */
export function bucketOf(overview: OverviewBuckets, t: number): number {
  if (overview.count === 0) {
    overview.start = Math.floor(t / OVERVIEW_BUCKET_MS) * OVERVIEW_BUCKET_MS;
  }
  let bucket = Math.floor((t - overview.start) / OVERVIEW_BUCKET_MS);
  if (bucket < 0) return -1;
  if (bucket >= OVERVIEW_BUCKETS) {
    scrollBuckets(overview, bucket - OVERVIEW_BUCKETS + 1);
    bucket = OVERVIEW_BUCKETS - 1;
  }
  if (bucket >= overview.count) {
    emptyBuckets(overview, overview.count, bucket + 1);
    overview.count = bucket + 1;
  }
  return bucket;
}

/**
 * Folds one row into its bucket: a bucket's first row decides whether it rested; an awake row
 * clears the rested flag and its ms replaces a rest's; the worst awake ms and the best-ranked spike
 * cause are kept.
 *
 * @param overview - The buckets.
 * @param bucket - The row's bucket.
 * @param history - The history.
 * @param row - The row.
 */
function foldRow(
  overview: OverviewBuckets,
  bucket: number,
  history: PerfHistory,
  row: number
): void {
  const ms = history.ms[row] ?? 0;
  const rest = history.rest[row] ?? REST.awake;
  const rested = rest === REST.idle || rest === REST.break;
  const max = overview.max[bucket] ?? Number.NaN;
  const flags = overview.flags[bucket] ?? 0;
  const wasRested = (flags & OVERVIEW_FLAGS.rested) !== 0;
  if (Number.isNaN(max)) {
    overview.max[bucket] = ms;
    overview.flags[bucket] = rested ? flags | OVERVIEW_FLAGS.rested : flags;
  } else if (wasRested && !rested) {
    overview.max[bucket] = ms;
    overview.flags[bucket] = flags & ~OVERVIEW_FLAGS.rested;
  } else if (wasRested || !rested) {
    overview.max[bucket] = Math.max(max, ms);
  }
  const code = spikeCause(history.causes[row] ?? 0, rest);
  if (code === 0) return;
  const cause = overview.cause[bucket] ?? 0;
  overview.cause[bucket] = cause === 0 ? code : Math.min(cause, code);
  overview.flags[bucket] = (overview.flags[bucket] ?? 0) | OVERVIEW_FLAGS.spike;
}

/**
 * Folds the rows from `first` to the newest into the overview's buckets: each bucket keeps its worst
 * frame, its primary spike cause and whether it only rested. Call it after each appendFrames with
 * `history.count − added` (the first new row; older rows may have dropped meanwhile).
 *
 * @param series - The side series.
 * @param history - The history the rows were appended to.
 * @param first - The first new row.
 * @example
 * ```ts
 * const appended = appendFrames(history, wire);
 * noteRows(series, history, history.count - appended.added);
 * ```
 */
export function noteRows(series: MissionSeries, history: PerfHistory, first: number): void {
  const { overview } = series;
  for (let row = Math.max(0, first); row < history.count; row += 1) {
    const bucket = bucketOf(overview, history.t[row] ?? 0);
    if (bucket >= 0) foldRow(overview, bucket, history, row);
  }
  series.version += 1;
}

/**
 * Flags the buckets of the events from index `first` on: a GC or a rate change.
 *
 * @param series - The side series.
 * @param history - The history the events were appended to.
 * @param first - The first new event (`history.eventCount − added`).
 * @example
 * ```ts
 * const added = appendEvents(history, wire);
 * noteEvents(series, history, history.eventCount - added);
 * ```
 */
export function noteEvents(series: MissionSeries, history: PerfHistory, first: number): void {
  const { overview } = series;
  for (let index = Math.max(0, first); index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event === undefined || (event.kind !== "gc" && event.kind !== "rate")) continue;
    const bucket = bucketOf(overview, event.t);
    if (bucket < 0) continue;
    const flag = event.kind === "gc" ? OVERVIEW_FLAGS.gc : OVERVIEW_FLAGS.rate;
    overview.flags[bucket] = (overview.flags[bucket] ?? 0) | flag;
  }
  series.version += 1;
}
