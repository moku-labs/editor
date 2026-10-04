/**
 * @file flowView focus module — walking the graph from the Info tab: → follows the highlighted
 * Outcomes* row (default: the row on the trail, else the first row with a target), ← the
 * highlighted *Comes from* row (default: the first); ↑/↓ move the highlight through Outcomes, then
 * Comes from.
 */
import type { GraphJson, NodeId } from "../types";
import { incoming, outgoing } from "./graph";
import type { FocusState } from "./types";

/**
 * The default *Outcomes* row: the one on the trail, else the first with a target, else 0.
 *
 * @param rows - Rows with their edge key and target.
 * @param trail - Edge key → trail rank.
 * @returns The row index.
 * @example
 * ```ts
 * defaultRow([{ key: "a", to: undefined }, { key: "b", to: "x" }], new Map()); // 1
 * ```
 */
export function defaultRow(
  rows: readonly { readonly key: string; readonly to: NodeId | undefined }[],
  trail: ReadonlyMap<string, number>
): number {
  const onTrail = rows.findIndex(row => trail.has(row.key));
  if (onTrail !== -1) return onTrail;
  const withTarget = rows.findIndex(row => row.to !== undefined);
  return Math.max(0, withTarget);
}

/**
 * The Info tab row a walk step takes: the highlighted row of its side, else the default row.
 *
 * @param graph - The graph.
 * @param id - The shown node id.
 * @param direction - "prev" = ← (a Comes from row), "next" = → (an Outcomes row).
 * @param highlight - The Info tab highlight.
 * @param trail - Edge key → trail rank.
 * @param parent - The one parent instance on screen (resolves exit rows).
 * @returns The side and index of the row.
 * @example
 * ```ts
 * walkRow(graph, "board/tapGenerator", "next", { side: "to", index: -1 }, new Map()); // { side: "to", index: 0 }
 * ```
 */
export function walkRow(
  graph: GraphJson,
  id: NodeId,
  direction: "prev" | "next",
  highlight: FocusState["highlight"],
  trail: ReadonlyMap<string, number>,
  parent?: NodeId
): FocusState["highlight"] {
  if (direction === "next") {
    const isHighlighted = highlight.side === "to" && highlight.index >= 0;
    const index = isHighlighted ? highlight.index : defaultRow(outgoing(graph, id, parent), trail);
    return { side: "to", index };
  }
  const isHighlighted = highlight.side === "from" && highlight.index >= 0;
  return { side: "from", index: isHighlighted ? highlight.index : 0 };
}

/**
 * The node a walk step goes to.
 *
 * @param graph - The graph.
 * @param id - The shown node id.
 * @param direction - "prev" = ←, "next" = →.
 * @param highlight - The Info tab highlight.
 * @param trail - Edge key → trail rank.
 * @param parent - The one parent instance on screen (resolves exit rows).
 * @returns The target node id, or undefined when the row has none.
 * @example
 * ```ts
 * walkTarget(graph, "board/energy", "prev", { side: "to", index: 0 }, new Map()); // "board/tapGenerator"
 * ```
 */
export function walkTarget(
  graph: GraphJson,
  id: NodeId,
  direction: "prev" | "next",
  highlight: FocusState["highlight"],
  trail: ReadonlyMap<string, number>,
  parent?: NodeId
): NodeId | undefined {
  const row = walkRow(graph, id, direction, highlight, trail, parent);
  if (direction === "next") return outgoing(graph, id, parent)[row.index]?.to;
  return incoming(graph, id)[row.index]?.from;
}

/**
 * Moves the highlight one row up or down through the Info tab rows: the Outcomes rows, then the
 * Comes from rows, clamped at both ends. The first press highlights the first row.
 *
 * @param highlight - The highlight.
 * @param delta - -1 up, 1 down.
 * @param counts - Row counts of the two lists.
 * @param counts.from - Rows of *Comes from*.
 * @param counts.to - Rows of *Outcomes*.
 * @returns The new highlight (index -1 when there are no rows).
 * @example
 * ```ts
 * moveHighlight({ side: "to", index: 3 }, 1, { from: 1, to: 4 }); // { side: "from", index: 0 }
 * ```
 */
export function moveHighlight(
  highlight: FocusState["highlight"],
  delta: 1 | -1,
  counts: { readonly from: number; readonly to: number }
): FocusState["highlight"] {
  const total = counts.to + counts.from;
  if (total === 0) return { side: "to", index: -1 };

  // One list: Outcomes rows first, then Comes from rows.
  const flat = highlight.side === "to" ? highlight.index : counts.to + highlight.index;
  const next = highlight.index < 0 ? 0 : Math.min(total - 1, Math.max(0, flat + delta));
  return next < counts.to ? { side: "to", index: next } : { side: "from", index: next - counts.to };
}
