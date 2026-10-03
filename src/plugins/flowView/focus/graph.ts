/**
 * @file flowView focus module — pure graph queries: the runtime stack of a path, node kinds,
 * outgoing and incoming edges (with exit resolution and parent "via"), parents of a flow, edge
 * targets.
 */
import type { FlowJson, GraphJson, GraphNodeJson, NodeId } from "../types";
import type { IncomingEdge, NodeKind, OutgoingEdge, StackEntry } from "./types";

/**
 * Prefix of an exit target.
 */
const EXIT = "exit:";

/**
 * Prefix of a mapped target.
 */
const MAP = "map:";

/**
 * Splits a node id into flow and node.
 *
 * @param id - "<flow>/<node>".
 * @returns Flow and node names.
 * @example
 * ```ts
 * splitId("board/merge"); // { flow: "board", node: "merge" }
 * ```
 */
export function splitId(id: NodeId): { readonly flow: string; readonly node: string } {
  const slash = id.indexOf("/");
  return slash === -1
    ? { flow: id, node: "" }
    : { flow: id.slice(0, slash), node: id.slice(slash + 1) };
}

/**
 * The graph node of an id.
 *
 * @param graph - The graph.
 * @param id - A node id.
 * @returns The node, or undefined.
 * @example
 * ```ts
 * nodeOf(graph, "board/merge")?.outcomes; // ["done", "rejected"]
 * ```
 */
export function nodeOf(graph: GraphJson, id: NodeId): GraphNodeJson | undefined {
  const { flow, node } = splitId(id);
  return graph.flows[flow]?.nodes[node];
}

/**
 * The node id an edge target points to inside a flow; an exit has none.
 *
 * @param flow - The flow of the edge.
 * @param target - "node", "map:node" or "exit:x".
 * @returns The node id, or undefined.
 * @example
 * ```ts
 * targetOf("main", "map:home"); // "main/home"
 * ```
 */
export function targetOf(flow: string, target: string): NodeId | undefined {
  if (target.startsWith(EXIT)) return undefined;
  return `${flow}/${target.startsWith(MAP) ? target.slice(MAP.length) : target}`;
}

/**
 * The flows a node opens: its sub-flow, or the contributions of its slot by order.
 *
 * @param graph - The graph.
 * @param node - The node.
 * @returns Flow names.
 */
function opened(graph: GraphJson, node: GraphNodeJson): string[] {
  if (node.subFlow !== undefined) return [node.subFlow];
  if (node.slot === undefined) return [];
  return (graph.slots[node.slot] ?? [])
    .toSorted((a, b) => a.order - b.order)
    .map(entry => entry.flow);
}

/**
 * Resolves a path (node names per nesting level) to the runtime stack. Level 0 is in the main
 * flow; level i+1 is in the sub-flow of level i, or in the first slot contribution that has the
 * node. An unresolvable tail is dropped.
 *
 * @param graph - The graph.
 * @param path - The position or history path.
 * @returns The stack, outermost first.
 * @example
 * ```ts
 * resolveStack(graph, "board/awaitIntent").map(entry => entry.id); // ["main/board", "board/awaitIntent"]
 * ```
 */
export function resolveStack(graph: GraphJson, path: string): readonly StackEntry[] {
  const stack: StackEntry[] = [];
  let flows = [graph.main];

  for (const segment of path.split("/")) {
    if (segment === "") break;
    const flow = flows.find(name => graph.flows[name]?.nodes[segment] !== undefined);
    const node = flow === undefined ? undefined : graph.flows[flow]?.nodes[segment];
    if (flow === undefined || node === undefined) break;
    stack.push({ flow, node: segment, id: `${flow}/${segment}` });
    flows = opened(graph, node);
  }
  return stack;
}

/**
 * The kinds of a node: start, then rest / transit / sub-flow / slot, then checkpoint, over,
 * barrier.
 *
 * @param graph - The graph.
 * @param id - A node id.
 * @returns The kinds (empty for an unknown id).
 * @example
 * ```ts
 * nodeKinds(graph, "board/awaitIntent"); // ["start", "rest"]
 * ```
 */
export function nodeKinds(graph: GraphJson, id: NodeId): readonly NodeKind[] {
  const node = nodeOf(graph, id);
  if (node === undefined) return [];
  const { flow, node: name } = splitId(id);
  const kinds: NodeKind[] = [];

  if (graph.flows[flow]?.start === name) kinds.push("start");
  if (node.rest) kinds.push("rest");
  else if (node.subFlow !== undefined) kinds.push("sub-flow");
  else if (node.slot === undefined) {
    kinds.push("transit");
  } else {
    kinds.push("slot");
  }
  if (node.checkpoint) kinds.push("checkpoint");
  if (node.over) kinds.push("over");
  if (node.barrier) kinds.push("barrier");
  return kinds;
}

/**
 * The back edges of a flow by a depth-first search from its start (declared order).
 *
 * @param flow - The flow.
 * @returns "<node>:<outcome>" keys of back edges.
 * @example
 * ```ts
 * backEdges(board).has("merge:done"); // true
 * ```
 */
function backEdges(flow: FlowJson): ReadonlySet<string> {
  const back = new Set<string>();
  const visited = new Set<string>();
  const stack = new Set<string>();

  /**
   * Visits one node.
   *
   * @param name - The node name.
   */
  function visit(name: string): void {
    visited.add(name);
    stack.add(name);
    for (const outcome of flow.nodes[name]?.outcomes ?? []) {
      const raw = flow.edges[name]?.[outcome] ?? EXIT;
      if (raw.startsWith(EXIT)) continue;
      const target = raw.startsWith(MAP) ? raw.slice(MAP.length) : raw;
      if (stack.has(target)) back.add(`${name}:${outcome}`);
      else if (!visited.has(target) && flow.nodes[target] !== undefined) visit(target);
    }
    stack.delete(name);
  }

  if (flow.nodes[flow.start] !== undefined) visit(flow.start);
  for (const name of Object.keys(flow.nodes)) if (!visited.has(name)) visit(name);
  return back;
}

/**
 * The outgoing edges of a node in declared order. An `exit:x` row resolves through the parent's
 * edge `x` when the caller names the one parent instance on screen.
 *
 * @param graph - The graph.
 * @param id - A node id.
 * @param parent - The parent sub-flow node of the one instance on screen.
 * @returns The rows.
 * @example
 * ```ts
 * outgoing(graph, "board/giveToOrder", "main/board")[1]?.to; // "main/afterOrder"
 * ```
 */
export function outgoing(graph: GraphJson, id: NodeId, parent?: NodeId): readonly OutgoingEdge[] {
  const node = nodeOf(graph, id);
  const { flow, node: name } = splitId(id);
  const flowJson = graph.flows[flow];
  if (node === undefined || flowJson === undefined) return [];
  const back = backEdges(flowJson);

  return node.outcomes.map(outcome => {
    const raw = flowJson.edges[name]?.[outcome];
    const key = `${id}:${outcome}`;
    if (raw?.startsWith(EXIT)) {
      const exit = raw.slice(EXIT.length);
      const outer = parent === undefined ? undefined : splitId(parent);
      const via =
        outer === undefined ? undefined : graph.flows[outer.flow]?.edges[outer.node]?.[exit];
      const to = outer === undefined || via === undefined ? undefined : targetOf(outer.flow, via);
      return { outcome, key, to, exit, back: false };
    }
    const to = raw === undefined ? undefined : targetOf(flow, raw);
    return { outcome, key, to, back: back.has(`${name}:${outcome}`) };
  });
}

/**
 * The nodes that open a flow: sub-flow nodes and slot nodes with a contribution of it, in
 * declared order.
 *
 * @param graph - The graph.
 * @param flow - A flow name.
 * @returns Node ids.
 * @example
 * ```ts
 * parentsOf(graph, "settingsPopup"); // ["main/settings", "board/settings"]
 * ```
 */
export function parentsOf(graph: GraphJson, flow: string): readonly NodeId[] {
  const parents: NodeId[] = [];
  for (const [flowName, flowJson] of Object.entries(graph.flows)) {
    for (const [name, node] of Object.entries(flowJson.nodes)) {
      if (opened(graph, node).includes(flow)) parents.push(`${flowName}/${name}`);
    }
  }
  return parents;
}

/**
 * The edges into one node of its flow, in declared order.
 *
 * @param graph - The graph.
 * @param id - A node id.
 * @param via - The parent the edges enter through.
 * @returns The rows.
 * @example
 * ```ts
 * edgesInto(graph, "main/board", undefined).map(row => row.key); // ["main/home:play", "main/afterOrder:done"]
 * ```
 */
function edgesInto(graph: GraphJson, id: NodeId, via?: NodeId): IncomingEdge[] {
  const { flow, node } = splitId(id);
  const rows: IncomingEdge[] = [];
  for (const [source, edges] of Object.entries(graph.flows[flow]?.edges ?? {})) {
    for (const [outcome, raw] of Object.entries(edges)) {
      if (targetOf(flow, raw) !== `${flow}/${node}`) continue;
      rows.push({ from: `${flow}/${source}`, outcome, key: `${flow}/${source}:${outcome}`, via });
    }
  }
  return rows;
}

/**
 * The incoming edges of a node: every edge of its flow into it, and, when it is its flow's start,
 * the incoming edges of each parent sub-flow node ("via").
 *
 * @param graph - The graph.
 * @param id - A node id.
 * @returns The rows.
 * @example
 * ```ts
 * incoming(graph, "board/awaitIntent").filter(row => row.via).map(row => row.from); // ["main/home", "main/afterOrder"]
 * ```
 */
export function incoming(graph: GraphJson, id: NodeId): readonly IncomingEdge[] {
  const { flow, node } = splitId(id);
  if (nodeOf(graph, id) === undefined) return [];
  const rows = edgesInto(graph, id);
  if (graph.flows[flow]?.start !== node) return rows;
  for (const parent of parentsOf(graph, flow)) rows.push(...edgesInto(graph, parent, parent));
  return rows;
}
