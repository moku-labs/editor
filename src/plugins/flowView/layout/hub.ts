/**
 * @file flowView layout module — hub detection (design §7.1): the rest node with the most
 * returning nodes becomes the hub, when it has enough outcomes and returns.
 */
import type { FlowHubConfig, FlowJson } from "../types";
import { targetNode } from "./back-edges";

/**
 * The number of distinct nodes m ≠ n of the flow with at least one edge into n.
 *
 * @param flow - The flow.
 * @param node - The node name.
 * @returns The return count.
 * @example
 * ```ts
 * returnsOf(board, "awaitIntent"); // 9
 * ```
 */
export function returnsOf(flow: FlowJson, node: string): number {
  let count = 0;
  for (const [source, edges] of Object.entries(flow.edges)) {
    if (source === node) continue;
    if (Object.values(edges).some(target => targetNode(target) === node)) count += 1;
  }
  return count;
}

/**
 * The hub of a flow: among rest nodes with ≥ `rule.minOutcomes` outcomes and ≥ `rule.minReturns`
 * returns, the one with the most returns; ties go to the earlier node in declared order.
 *
 * @param flow - The flow.
 * @param rule - The hub rule: minOutcomes and minReturns.
 * @returns The hub node name, or undefined.
 */
export function detectHub(flow: FlowJson, rule: FlowHubConfig): string | undefined {
  let best: string | undefined;
  let bestReturns = -1;

  for (const [name, node] of Object.entries(flow.nodes)) {
    if (!node.rest || node.outcomes.length < rule.minOutcomes) continue;
    const returns = returnsOf(flow, name);
    if (returns >= rule.minReturns && returns > bestReturns) {
      best = name;
      bestReturns = returns;
    }
  }
  return best;
}
