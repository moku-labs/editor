/**
 * @file flowView focus module — instance edges on the canvas: the instance key of an Info tab
 * row's edge (an Outcomes row leaves the shown instance, a Comes from row enters it, a "via" row
 * enters its parent sub-flow), and the other end of an edge (a stub stands for its node, an exit
 * goes on through its frame's edge).
 */
import { instanceKey } from "../layout/compose";
import type { EdgePath, Item, ItemKey, LayoutResult, NodeId } from "../types";
import type { IncomingEdge } from "./types";

/**
 * Item kinds that stand for a graph node.
 */
const NODE_KINDS: ReadonlySet<Item["kind"]> = new Set(["node", "hub", "frame"]);

/**
 * Deepest chain of exits one edge is followed through.
 */
const MAX_EXITS = 8;

/**
 * The frame part of an instance key: everything before its last `>` ("" in the root frame).
 *
 * @param key - An instance key.
 * @returns The frame key.
 * @example
 * ```ts
 * prefixOf("main/board>board/merge"); // "main/board"
 * ```
 */
export function prefixOf(key: ItemKey): string {
  return key.slice(0, Math.max(0, key.lastIndexOf(">")));
}

/**
 * The local part of an instance key: everything after its last `>`.
 *
 * @param key - An instance key.
 * @returns The local key (a node id, a stub, a port, a graph edge key).
 * @example
 * ```ts
 * localKey("main/board>board/merge:done"); // "board/merge:done"
 * ```
 */
export function localKey(key: string): string {
  return key.slice(key.lastIndexOf(">") + 1);
}

/**
 * The drawn edge of an instance edge key, if it is on the canvas.
 *
 * @param result - The layout.
 * @param key - The instance edge key.
 * @returns The edge, or undefined.
 */
function drawnEdge(result: LayoutResult, key: string): EdgePath | undefined {
  return result.edges.find(edge => edge.kind === "edge" && edge.key === key);
}

/**
 * The instance edge of an Outcomes row: "<shown key>:<outcome>", when it is drawn.
 *
 * @param result - The layout.
 * @param shown - The instance key of the shown node.
 * @param outcome - The row's outcome.
 * @returns The edge key, or undefined when the edge is not on the canvas.
 * @example
 * ```ts
 * outgoingEdgeKey(result, "main/board>board/merge", "done"); // "main/board>board/merge:done"
 * ```
 */
export function outgoingEdgeKey(
  result: LayoutResult,
  shown: ItemKey,
  outcome: string
): string | undefined {
  const key = `${shown}:${outcome}`;
  return drawnEdge(result, key) === undefined ? undefined : key;
}

/**
 * The first instance on the canvas of a node id (frames in layout order).
 *
 * @param result - The layout.
 * @param id - A node id.
 * @returns The instance key, or undefined.
 */
function instanceOf(result: LayoutResult, id: NodeId): ItemKey | undefined {
  return result.items.find(
    entry => entry.id === id && NODE_KINDS.has(entry.kind) && !entry.key.startsWith("#")
  )?.key;
}

/**
 * The instance edge and source of a Comes from row. A plain row enters the shown instance from its
 * own frame; a "via" row enters the parent sub-flow: the frame the shown node sits in when that is
 * the parent, else the parent's first instance.
 *
 * @param result - The layout.
 * @param shown - The instance key of the shown node.
 * @param row - The incoming row.
 * @returns The edge key and the source instance key, or undefined when the edge is not drawn.
 * @example
 * ```ts
 * incomingEdge(result, "main/board>board/awaitIntent", { from: "main/home", outcome: "play", key: "main/home:play", via: "main/board" });
 * // { edgeKey: "main/home:play", sourceKey: "main/home" }
 * ```
 */
export function incomingEdge(
  result: LayoutResult,
  shown: ItemKey,
  row: IncomingEdge
): { readonly edgeKey: string; readonly sourceKey: ItemKey } | undefined {
  let frame = prefixOf(shown);
  if (row.via !== undefined) {
    const parent =
      frame !== "" && localKey(frame) === row.via ? frame : instanceOf(result, row.via);
    if (parent === undefined) return undefined;
    frame = prefixOf(parent);
  }
  const edgeKey = instanceKey(frame, row.key);
  if (drawnEdge(result, edgeKey) === undefined) return undefined;
  return { edgeKey, sourceKey: instanceKey(frame, row.from) };
}

/**
 * The node instance an edge leads to: a node, hub or frame as it is; a stub's node in the stub's
 * frame; an exit through the edge its frame takes for that exit.
 *
 * @param result - The layout.
 * @param edge - A drawn edge.
 * @param depth - Exits followed so far.
 * @returns The instance key, or undefined when the end is not on the canvas.
 */
function targetOf(result: LayoutResult, edge: EdgePath, depth: number): ItemKey | undefined {
  const target = edge.to === undefined ? undefined : result.byKey[edge.to];
  if (target === undefined) return undefined;
  if (NODE_KINDS.has(target.kind)) return target.key;

  if (target.kind === "stub") {
    const key = instanceKey(prefixOf(target.key), target.target ?? "");
    return result.byKey[key] === undefined ? undefined : key;
  }

  // An exit port: the frame's own edge of that name carries the walk on.
  const frame = prefixOf(target.key);
  const exit = localKey(target.key).slice("exit:".length);
  const outer = result.edges.find(
    entry => entry.kind === "edge" && entry.from === frame && entry.outcome === exit
  );
  return outer === undefined || depth >= MAX_EXITS ? undefined : targetOf(result, outer, depth + 1);
}

/**
 * True when an edge enters the shown instance: the node it leads to (a stub resolved to its node,
 * an exit followed through its frame) is the shown instance, or the expanded parent the shown
 * instance sits in (a "via" edge), and the edge does not start there.
 *
 * @param result - The layout.
 * @param edge - A drawn edge.
 * @param shown - The instance key of the shown node.
 * @returns Whether the walk goes back to the edge's source.
 */
function enters(result: LayoutResult, edge: EdgePath, shown: ItemKey): boolean {
  if (edge.from === shown) return false;
  const target = targetOf(result, edge, 0);
  return target !== undefined && (target === shown || shown.startsWith(`${target}>`));
}

/**
 * The other end of an edge seen from the shown instance: its source when the edge enters the
 * shown instance (also through a stub, as a back edge into the node is drawn), else its target.
 *
 * @param result - The layout.
 * @param edgeKey - An instance edge key.
 * @param shown - The instance key of the shown node.
 * @returns The end the walk reaches and the end it starts from, or undefined.
 * @example
 * ```ts
 * otherEnd(result, "main/board>board/merge:done", "main/board>board/merge");
 * // { reached: "main/board>board/awaitIntent", start: "main/board>board/merge" }
 * ```
 */
export function otherEnd(
  result: LayoutResult,
  edgeKey: string,
  shown: ItemKey | undefined
): { readonly reached: ItemKey; readonly start: ItemKey } | undefined {
  const edge = drawnEdge(result, edgeKey);
  if (edge === undefined) return undefined;

  // Entering the shown instance: walk back to the source.
  if (shown !== undefined && enters(result, edge, shown)) {
    const source = result.byKey[edge.from];
    if (source === undefined || !NODE_KINDS.has(source.kind)) return undefined;
    return { reached: source.key, start: shown };
  }

  // Leaving it (or seen from elsewhere): walk on to the target.
  const reached = targetOf(result, edge, 0);
  return reached === undefined ? undefined : { reached, start: edge.from };
}
