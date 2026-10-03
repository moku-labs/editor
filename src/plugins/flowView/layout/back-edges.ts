/**
 * @file flowView layout module — edge targets and the DFS edge classification of non-hub flows
 * (design §7.6): back edges become stubs, except the short loops that stay drawn.
 */
import type { FlowJson } from "../types";
import type { EdgeClass } from "./types";

/**
 * Prefix of an exit target.
 */
const EXIT = "exit:";

/**
 * Prefix of a mapped target.
 */
const MAP = "map:";

/**
 * The node an edge target points to inside its flow: "node" and "map:node" → "node"; an exit has
 * none.
 *
 * @param target - The edge target.
 * @returns The node name, or undefined for an exit.
 * @example
 * ```ts
 * targetNode("map:home"); // "home"
 * ```
 */
export function targetNode(target: string): string | undefined {
  if (target.startsWith(EXIT)) return undefined;
  return target.startsWith(MAP) ? target.slice(MAP.length) : target;
}

/**
 * The exit name of an edge target.
 *
 * @param target - The edge target.
 * @returns The exit name, or undefined.
 * @example
 * ```ts
 * exitOf("exit:left"); // "left"
 * ```
 */
export function exitOf(target: string): string | undefined {
  return target.startsWith(EXIT) ? target.slice(EXIT.length) : undefined;
}

/**
 * The distinct predecessors of every node (nodes with an edge into it), in declared order.
 *
 * @param flow - The flow.
 * @returns Node name → its predecessors.
 * @example
 * ```ts
 * predecessors(main).get("setLoading"); // ["splash"]
 * ```
 */
function predecessors(flow: FlowJson): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [source, edges] of Object.entries(flow.edges)) {
    for (const target of Object.values(edges)) {
      const node = targetNode(target);
      if (node === undefined) continue;
      const list = result.get(node) ?? [];
      if (!list.includes(source)) list.push(source);
      result.set(node, list);
    }
  }
  return result;
}

/**
 * True when a back edge u → v stays drawn: u is a plain node with exactly one outcome whose only
 * predecessor is v, and v has at most 2 outcomes.
 *
 * @param flow - The flow.
 * @param from - u.
 * @param to - v.
 * @param preds - Predecessors of every node.
 * @returns Whether the loop is short.
 * @example
 * ```ts
 * isShortLoop(main, "setLoading", "splash", predecessors(main)); // false
 * ```
 */
function isShortLoop(
  flow: FlowJson,
  from: string,
  to: string,
  preds: ReadonlyMap<string, readonly string[]>
): boolean {
  const source = flow.nodes[from];
  const target = flow.nodes[to];
  if (source === undefined || target === undefined) return false;
  if (source.subFlow !== undefined || source.slot !== undefined) return false;

  const only = preds.get(from);
  return (
    source.outcomes.length === 1 &&
    only?.length === 1 &&
    only[0] === to &&
    target.outcomes.length <= 2
  );
}

/**
 * Classifies every in-flow edge by a depth-first search from the start, outcomes in declared
 * order (then from the unreached nodes in declared order): an edge to a node on the DFS stack is
 * a back edge, kept as a short loop when the short-loop rule holds. Exit edges are not listed.
 *
 * @param flow - The flow.
 * @returns "<node>:<outcome>" → forward, back or short-loop.
 * @example
 * ```ts
 * classifyEdges(main).get("dailyGift:claim"); // "back"
 * ```
 */
export function classifyEdges(flow: FlowJson): ReadonlyMap<string, EdgeClass> {
  const classes = new Map<string, EdgeClass>();
  const preds = predecessors(flow);
  const visited = new Set<string>();
  const onStack = new Set<string>();

  /**
   * Visits one node depth first and classifies its outcomes.
   *
   * @param node - The node name.
   */
  function visit(node: string): void {
    visited.add(node);
    onStack.add(node);
    for (const outcome of flow.nodes[node]?.outcomes ?? []) {
      const raw = flow.edges[node]?.[outcome];
      const target = raw === undefined ? undefined : targetNode(raw);
      if (target === undefined || flow.nodes[target] === undefined) continue;

      const key = `${node}:${outcome}`;
      if (onStack.has(target)) {
        classes.set(key, isShortLoop(flow, node, target, preds) ? "short-loop" : "back");
      } else {
        classes.set(key, "forward");
        if (!visited.has(target)) visit(target);
      }
    }
    onStack.delete(node);
  }

  if (flow.nodes[flow.start] !== undefined) visit(flow.start);
  for (const node of Object.keys(flow.nodes)) if (!visited.has(node)) visit(node);
  return classes;
}
