/**
 * @file flowView plugin — focus/trail.ts (skeleton stubs, implemented in its wave).
 */
import type { GraphJson, HistoryEntryJson } from "../types";

/**
 * Skeleton stub for `trailRanks`; implemented in its wave.
 *
 * @param _history - The history.
 * @param _graph - The graph.
 * @param _count - The count.
 * @example
 * ```ts
 * trailRanks();
 * ```
 */
export function trailRanks(
  _history: readonly HistoryEntryJson[],
  _graph: GraphJson,
  _count: number
): ReadonlyMap<string, number> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `rejectedEdges`; implemented in its wave.
 *
 * @param _history - The history.
 * @param _graph - The graph.
 * @param _outcomes - The outcomes.
 * @example
 * ```ts
 * rejectedEdges();
 * ```
 */
export function rejectedEdges(
  _history: readonly HistoryEntryJson[],
  _graph: GraphJson,
  _outcomes: readonly string[]
): ReadonlyMap<string, HistoryEntryJson> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `frameLabel`; implemented in its wave.
 *
 * @param _entry - The entry.
 * @param _frames - The frames.
 * @example
 * ```ts
 * frameLabel();
 * ```
 */
export function frameLabel(_entry: HistoryEntryJson, _frames: ReadonlyMap<number, number>): string {
  throw new Error("not implemented");
}
