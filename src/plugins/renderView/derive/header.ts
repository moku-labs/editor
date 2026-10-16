/**
 * @file renderView derive — the frames header's headline (spec 09 § M8 Frames header): "{n} spikes in
 * view" (warn when there is one), "worst {ms} ms" (only with a spike), "p90 {ms} ms" of the awake
 * frames, "rest {s} s at {fps} fps" when the view rests, "{n} GC" while GCs are shown; nothing (the
 * component says "No frames yet") without frames. Pure.
 */
import { firstVisibleRow, rowFrom } from "../series/rows";
import type { PerfHistory } from "../source/contract";
import { REST, rateFps } from "../source/contract";
import type { MissionView } from "../types";
import type { Line } from "./words";
import { oneDecimal, strong } from "./words";

/**
 * One part of the headline; `warn` paints its number in the warn colour.
 *
 * @example
 * ```ts
 * const part: HeadlinePart = { key: "spikes", line: [{ strong: "3" }, " spikes in view"], warn: true };
 * ```
 */
export type HeadlinePart = {
  readonly key: "spikes" | "worst" | "p90" | "rest" | "gc";
  readonly line: Line;
  readonly warn: boolean;
};

/**
 * The rest rate of a view: the rate of its newest resting row.
 *
 * @param history - The history.
 * @param startMs - The view's start.
 * @param endMs - The view's end.
 * @returns fps; null when the view does not rest.
 * @example
 * ```ts
 * restFpsOf(history, 74_000, 80_000); // 30
 * ```
 */
export function restFpsOf(history: PerfHistory, startMs: number, endMs: number): number | null {
  const first = firstVisibleRow(history, startMs);
  for (let row = rowFrom(history, endMs) - 1; row >= first; row -= 1) {
    if (history.rest[row] === REST.idle) return rateFps(history.rateMs[row] ?? 0);
  }
  // eslint-disable-next-line unicorn/no-null -- null: the view does not rest
  return null;
}

/**
 * The headline of the view.
 *
 * @param stats - MissionView.stats of the view.
 * @param restFps - The view's rest rate; null when it does not rest.
 * @returns The parts; undefined without frames ("No frames yet").
 * @example
 * ```ts
 * framesHeadline({ frames: 360, spikes: 3, worstMs: 41.3, p90Ms: 14.2, restMs: 0, gcs: null }, null)?.length; // 3
 * ```
 */
export function framesHeadline(
  stats: MissionView["stats"],
  restFps: number | null
): HeadlinePart[] | undefined {
  if (stats.frames === 0) return undefined;
  const parts: HeadlinePart[] = [
    {
      key: "spikes",
      line: [strong(String(stats.spikes)), ` spike${stats.spikes === 1 ? "" : "s"} in view`],
      warn: stats.spikes > 0
    }
  ];
  if (stats.spikes > 0 && stats.worstMs !== null) {
    parts.push({
      key: "worst",
      line: ["worst ", strong(oneDecimal(stats.worstMs)), " ms"],
      warn: false
    });
  }
  if (stats.p90Ms !== null) {
    parts.push({ key: "p90", line: ["p90 ", strong(oneDecimal(stats.p90Ms)), " ms"], warn: false });
  }
  if (stats.restMs > 0) {
    const rate = restFps === null ? "" : ` at ${restFps} fps`;
    parts.push({
      key: "rest",
      line: ["rest ", strong(`${(stats.restMs / 1000).toFixed(1)} s`), rate],
      warn: false
    });
  }
  if (stats.gcs !== null) {
    parts.push({ key: "gc", line: [strong(String(stats.gcs)), " GC"], warn: false });
  }
  return parts;
}
