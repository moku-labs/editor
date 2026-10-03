/**
 * @file flowView focus module — the trail of the last edges, the rejected edges and the frame
 * labels of history entries (F-H1: `f<frame>` only for a known frame, never an invented one).
 */
import type { GraphJson, HistoryEntryJson } from "../types";
import { resolveStack } from "./graph";

/**
 * The edge key of a history entry: "<node id>:<outcome>" of its resolved node.
 *
 * @param entry - A history entry.
 * @param graph - The graph.
 * @returns The key, or undefined when the path does not resolve.
 * @example
 * ```ts
 * entryKey({ path: "board/merge", outcome: "done", … }, graph); // "board/merge:done"
 * ```
 */
export function entryKey(entry: HistoryEntryJson, graph: GraphJson): string | undefined {
  const node = resolveStack(graph, entry.path).at(-1);
  return node === undefined ? undefined : `${node.id}:${entry.outcome}`;
}

/**
 * Trail ranks of the newest entries: rank = position from the newest (0); the first occurrence
 * of an edge wins.
 *
 * @param history - Entries, oldest first.
 * @param graph - The graph.
 * @param count - How many of the newest entries count (trailLength).
 * @returns Edge key → rank.
 * @example
 * ```ts
 * trailRanks(history, graph, 6).get("board/merge:done"); // 0
 * ```
 */
export function trailRanks(
  history: readonly HistoryEntryJson[],
  graph: GraphJson,
  count: number
): ReadonlyMap<string, number> {
  const ranks = new Map<string, number>();
  const newest = history.slice(-count).toReversed();
  for (const [rank, entry] of newest.entries()) {
    const key = entryKey(entry, graph);
    if (key !== undefined && !ranks.has(key)) ranks.set(key, rank);
  }
  return ranks;
}

/**
 * The last history entry of every edge key (when each edge last fired).
 *
 * @param history - Entries, oldest first.
 * @param graph - The graph.
 * @returns Edge key → its last entry.
 * @example
 * ```ts
 * const fires = lastFires([{ index: 3, path: "board/merge", outcome: "done", … }], graph);
 * fires.get("board/merge:done")?.index; // 3
 * ```
 */
export function lastFires(
  history: readonly HistoryEntryJson[],
  graph: GraphJson
): ReadonlyMap<string, HistoryEntryJson> {
  const fires = new Map<string, HistoryEntryJson>();
  for (const entry of history) {
    const key = entryKey(entry, graph);
    if (key !== undefined) fires.set(key, entry);
  }
  return fires;
}

/**
 * The last rejected entry of every edge whose outcome is a rejection.
 *
 * @param history - Entries, oldest first.
 * @param graph - The graph.
 * @param outcomes - The rejection outcome names.
 * @returns Edge key → its last rejected entry.
 * @example
 * ```ts
 * rejectedEdges(history, graph, ["rejected"]).get("board/merge:rejected")?.frame; // 1778
 * ```
 */
export function rejectedEdges(
  history: readonly HistoryEntryJson[],
  graph: GraphJson,
  outcomes: readonly string[]
): ReadonlyMap<string, HistoryEntryJson> {
  const rejected = new Map<string, HistoryEntryJson>();
  for (const entry of history) {
    if (!outcomes.includes(entry.outcome)) continue;
    const key = entryKey(entry, graph);
    if (key !== undefined) rejected.set(key, entry);
  }
  return rejected;
}

/**
 * The frame of an entry: its own `frame` (F-H1), else the frame flowView saw it arrive at.
 *
 * @param entry - A history entry.
 * @param frames - Entry index → frame seen live.
 * @returns The frame, or undefined.
 * @example
 * ```ts
 * entryFrame({ index: 4, … }, new Map([[4, 1790]])); // 1790
 * ```
 */
export function entryFrame(
  entry: HistoryEntryJson,
  frames: ReadonlyMap<number, number>
): number | undefined {
  return entry.frame ?? frames.get(entry.index);
}

/**
 * The label of an entry: `f<frame>` when the frame is known, else `#<index>`.
 *
 * @param entry - A history entry.
 * @param frames - Entry index → frame seen live.
 * @returns The label.
 * @example
 * ```ts
 * frameLabel({ index: 12, … }, new Map()); // "#12"
 * ```
 */
export function frameLabel(entry: HistoryEntryJson, frames: ReadonlyMap<number, number>): string {
  const frame = entryFrame(entry, frames);
  return frame === undefined ? `#${entry.index}` : `f${frame}`;
}
