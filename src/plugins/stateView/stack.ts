/**
 * @file stateView plugin — stack.ts (skeleton stubs, implemented in its wave).
 */
import type { Json } from "../registry/protocol";
import type { StackFrame } from "./types";

/**
 * Skeleton stub for `stackOf`; implemented in its wave.
 *
 * @param _path - The path.
 * @param _graph - The graph.
 * @param _topFlow - The topFlow.
 * @example
 * ```ts
 * stackOf();
 * ```
 */
export function stackOf(
  _path: string,
  _graph: Json | undefined,
  _topFlow: string | undefined
): readonly StackFrame[] {
  throw new Error("not implemented");
}
