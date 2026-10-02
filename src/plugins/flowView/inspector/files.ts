/**
 * @file flowView plugin — inspector/files.ts (skeleton stubs, implemented in its wave).
 */
import type { FlowCtx, GraphJson, NodeId } from "../types";
import type { SourceLookup } from "./types";

/**
 * Skeleton stub for `loadSourceLookup`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * loadSourceLookup();
 * ```
 */
export function loadSourceLookup(_ctx: FlowCtx): Promise<SourceLookup> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `fileOfNode`; implemented in its wave.
 *
 * @param _lookup - The lookup.
 * @param _graph - The graph.
 * @param _id - The id.
 * @example
 * ```ts
 * fileOfNode();
 * ```
 */
export function fileOfNode(
  _lookup: SourceLookup,
  _graph: GraphJson,
  _id: NodeId
): string | undefined {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `lineOf`; implemented in its wave.
 *
 * @param _text - The text.
 * @param _node - The node.
 * @example
 * ```ts
 * lineOf();
 * ```
 */
export function lineOf(_text: string, _node: string): number {
  throw new Error("not implemented");
}
