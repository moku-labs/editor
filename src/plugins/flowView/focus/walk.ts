/**
 * @file flowView focus module — walking the graph through the neighbours strip: → follows the
 * highlighted *Goes to* row (default: the row on the trail, else the first row with a target),
 * ← the highlighted *Comes from* row (default: the first); ↑/↓ move the highlight.
 */
import type { GraphJson, NodeId } from "../types";
import { incoming, outgoing } from "./graph";
import type { FocusState } from "./types";

/**
 * The default *Goes to* row: the one on the trail, else the first with a target, else 0.
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
 * The node a walk step goes to.
 *
 * @param graph - The graph.
 * @param id - The focused node id.
 * @param direction - "prev" = ←, "next" = →.
 * @param highlight - The strip highlight.
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
  if (direction === "next") {
    const rows = outgoing(graph, id, parent);
    const index =
      highlight.side === "to" && highlight.index >= 0 ? highlight.index : defaultRow(rows, trail);
    return rows[index]?.to;
  }
  const rows = incoming(graph, id);
  const index = highlight.side === "from" && highlight.index >= 0 ? highlight.index : 0;
  return rows[index]?.from;
}

/**
 * Moves the highlight one row up or down inside its column, clamped to the rows.
 *
 * @param highlight - The highlight.
 * @param delta - -1 up, 1 down.
 * @param counts - Row counts of the two columns.
 * @param counts.from - Rows of *Comes from*.
 * @param counts.to - Rows of *Goes to*.
 * @returns The new highlight.
 * @example
 * ```ts
 * moveHighlight({ side: "to", index: 0 }, 1, { from: 1, to: 4 }); // { side: "to", index: 1 }
 * ```
 */
export function moveHighlight(
  highlight: FocusState["highlight"],
  delta: 1 | -1,
  counts: { readonly from: number; readonly to: number }
): FocusState["highlight"] {
  const rows = highlight.side === "from" ? counts.from : counts.to;
  const index = Math.min(Math.max(0, rows - 1), Math.max(0, highlight.index + delta));
  return { side: highlight.side, index };
}
