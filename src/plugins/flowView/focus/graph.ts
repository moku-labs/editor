/**
 * @file flowView plugin — focus/graph.ts (skeleton stubs, implemented in its wave).
 */
import type { GraphJson, NodeId } from "../types";
import type { IncomingEdge, NodeKind, OutgoingEdge, StackEntry } from "./types";

/**
 * Skeleton stub for `resolveStack`; implemented in its wave.
 *
 * @param _graph - The graph.
 * @param _path - The path.
 * @example
 * ```ts
 * resolveStack();
 * ```
 */
export function resolveStack(_graph: GraphJson, _path: string): readonly StackEntry[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `nodeKinds`; implemented in its wave.
 *
 * @param _graph - The graph.
 * @param _id - The id.
 * @example
 * ```ts
 * nodeKinds();
 * ```
 */
export function nodeKinds(_graph: GraphJson, _id: NodeId): readonly NodeKind[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `outgoing`; implemented in its wave.
 *
 * @param _graph - The graph.
 * @param _id - The id.
 * @example
 * ```ts
 * outgoing();
 * ```
 */
export function outgoing(_graph: GraphJson, _id: NodeId): readonly OutgoingEdge[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `incoming`; implemented in its wave.
 *
 * @param _graph - The graph.
 * @param _id - The id.
 * @example
 * ```ts
 * incoming();
 * ```
 */
export function incoming(_graph: GraphJson, _id: NodeId): readonly IncomingEdge[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `parentsOf`; implemented in its wave.
 *
 * @param _graph - The graph.
 * @param _flow - The flow.
 * @example
 * ```ts
 * parentsOf();
 * ```
 */
export function parentsOf(_graph: GraphJson, _flow: string): readonly NodeId[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `targetOf`; implemented in its wave.
 *
 * @param _flow - The flow.
 * @param _target - The target.
 * @example
 * ```ts
 * targetOf();
 * ```
 */
export function targetOf(_flow: string, _target: string): NodeId | undefined {
  throw new Error("not implemented");
}
