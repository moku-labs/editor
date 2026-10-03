/**
 * @file flowView plugin — focus/walk.ts (skeleton stubs, implemented in its wave).
 */
import type { GraphJson, NodeId } from "../types";
import type { FocusState } from "./types";

/**
 * Skeleton stub for `walkTarget`; implemented in its wave.
 *
 * @param _graph - The graph.
 * @param _id - The id.
 * @param _direction - The direction.
 * @param _highlight - The highlight.
 * @param _trail - The trail.
 * @example
 * ```ts
 * walkTarget();
 * ```
 */
export function walkTarget(
  _graph: GraphJson,
  _id: NodeId,
  _direction: "prev" | "next",
  _highlight: FocusState["highlight"],
  _trail: ReadonlyMap<string, number>
): NodeId | undefined {
  throw new Error("not implemented");
}
