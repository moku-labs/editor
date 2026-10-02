/**
 * @file flowView plugin — layout/elk-graph.ts (skeleton stubs, implemented in its wave).
 */

import type { ElkNode } from "elkjs";
import type { FlowJson } from "../types";
import type { FlowBox } from "./types";

/**
 * Skeleton stub for `toElkGraph`; implemented in its wave.
 *
 * @param _flowName - The flowName.
 * @param _flow - The flow.
 * @param _classes - The classes.
 * @example
 * ```ts
 * toElkGraph();
 * ```
 */
export function toElkGraph(
  _flowName: string,
  _flow: FlowJson,
  _classes: ReadonlyMap<string, "forward" | "back" | "short-loop">
): ElkNode {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `fromElkGraph`; implemented in its wave.
 *
 * @param _flowName - The flowName.
 * @param _output - The output.
 * @example
 * ```ts
 * fromElkGraph();
 * ```
 */
export function fromElkGraph(_flowName: string, _output: ElkNode): FlowBox {
  throw new Error("not implemented");
}
