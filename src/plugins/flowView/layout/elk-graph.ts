/**
 * @file flowView layout module — the ELK input of a non-hub flow (design §7.6: nodes with
 * FIXED_ORDER east ports, back edges as 120×24 stub nodes, exits in the last layer) and the
 * mapping of ELK's output back to items and edges.
 */
import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from "elkjs";
import type { EdgePath, FlowJson, Item } from "../types";
import { exitOf, targetNode } from "./back-edges";
import { anchorIn, anchorOut, orthogonalRoute } from "./routes";
import type { EdgeClass, FlowBox, NodeSizes } from "./types";
import { FRAME_PAD, NODE_H, NODE_W, PORT, STUB_H, STUB_W } from "./types";

/**
 * The ELK options of every non-hub flow (spec layout/ §4), seed 1 for determinism.
 */
export const ELK_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "150",
  "elk.spacing.nodeNode": "24",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.portConstraints": "FIXED_ORDER",
  "elk.randomSeed": "1",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]"
};

/**
 * Element id prefixes of the ELK graph.
 */
const ID = { node: "n:", port: "p:", entry: "in:", stub: "s:", exit: "x:", edge: "e:" } as const;

/**
 * The ports of one node: outcomes on the east side in declared order, then the west entry.
 *
 * @param node - The node name.
 * @param outcomes - Its outcomes.
 * @returns The ELK ports.
 * @example
 * ```ts
 * portsOf("home", ["play"]).map(port => port.id); // ["p:home:play", "in:home"]
 * ```
 */
function portsOf(node: string, outcomes: readonly string[]): ElkPort[] {
  const east = outcomes.map(
    (outcome, index): ElkPort => ({
      id: `${ID.port}${node}:${outcome}`,
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": "EAST", "elk.port.index": String(index) }
    })
  );
  const west: ElkPort = {
    id: `${ID.entry}${node}`,
    width: 0,
    height: 0,
    layoutOptions: { "elk.port.side": "WEST", "elk.port.index": String(outcomes.length) }
  };
  return [...east, west];
}

/**
 * The ELK graph being built.
 */
type ElkBuild = {
  readonly flow: FlowJson;
  readonly classes: ReadonlyMap<string, EdgeClass>;
  readonly only: ReadonlySet<string> | undefined;
  readonly children: ElkNode[];
  readonly edges: ElkExtendedEdge[];
  readonly exits: Set<string>;
};

/**
 * True when a node belongs to the laid-out set.
 *
 * @param build - The graph being built.
 * @param node - The node name.
 * @returns Whether the node is laid out.
 * @example
 * ```ts
 * included(build, "home"); // true without a subset
 * ```
 */
function included(build: ElkBuild, node: string): boolean {
  return build.only === undefined || build.only.has(node);
}

/**
 * Adds the ELK edge of one outcome: to an exit node (added once, last layer), to a stub node for a
 * back edge or a target outside the subset, else to the target's entry port.
 *
 * @param build - The graph being built.
 * @param node - The source node.
 * @param outcome - The outcome.
 * @example
 * ```ts
 * addEdge(build, "home", "play");
 * ```
 */
function addEdge(build: ElkBuild, node: string, outcome: string): void {
  const raw = build.flow.edges[node]?.[outcome];
  if (raw === undefined) return;
  const source = `${ID.port}${node}:${outcome}`;
  const id = `${ID.edge}${node}:${outcome}`;
  const exit = exitOf(raw);
  const target = targetNode(raw);

  if (exit !== undefined) {
    if (!build.exits.has(exit)) {
      build.exits.add(exit);
      build.children.push({
        id: `${ID.exit}${exit}`,
        width: PORT,
        height: PORT,
        layoutOptions: { "elk.layered.layering.layerConstraint": "LAST" }
      });
    }
    build.edges.push({ id, sources: [source], targets: [`${ID.exit}${exit}`] });
    return;
  }
  if (target === undefined || build.flow.nodes[target] === undefined) return;
  const isStub = build.classes.get(`${node}:${outcome}`) === "back" || !included(build, target);
  if (isStub) {
    build.children.push({ id: `${ID.stub}${node}:${outcome}`, width: STUB_W, height: STUB_H });
    build.edges.push({ id, sources: [source], targets: [`${ID.stub}${node}:${outcome}`] });
  } else {
    build.edges.push({ id, sources: [source], targets: [`${ID.entry}${target}`] });
  }
}

/**
 * Builds the ELK input of a flow: every node (card size, or its expanded box), every forward and
 * short-loop edge, one stub node per back edge (or per edge leaving the `only` subset), exits as
 * small nodes in the last layer.
 *
 * @param flowName - The flow name.
 * @param flow - The flow.
 * @param classes - The DFS edge classes.
 * @param sizes - Sizes of expanded boxes by node name.
 * @param only - Lay out only these nodes (the unreached block of a hub flow).
 * @returns The ELK graph.
 * @example
 * ```ts
 * toElkGraph("main", main, classifyEdges(main)).children?.length; // 13
 * ```
 */
export function toElkGraph(
  flowName: string,
  flow: FlowJson,
  classes: ReadonlyMap<string, EdgeClass>,
  sizes: NodeSizes = new Map(),
  only?: ReadonlySet<string>
): ElkNode {
  const build: ElkBuild = { flow, classes, only, children: [], edges: [], exits: new Set() };
  const nodes = Object.entries(flow.nodes).filter(([node]) => included(build, node));
  for (const [node, info] of nodes) {
    const size = sizes.get(node) ?? { w: NODE_W, h: NODE_H };
    build.children.push({
      id: `${ID.node}${node}`,
      width: size.w,
      height: size.h,
      layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
      ports: portsOf(node, info.outcomes)
    });
  }
  for (const [node, info] of nodes)
    for (const outcome of info.outcomes) addEdge(build, node, outcome);
  return {
    id: flowName,
    layoutOptions: { ...ELK_OPTIONS },
    children: build.children,
    edges: build.edges
  };
}

/**
 * Splits "<node>:<outcome>".
 *
 * @param text - The joined text.
 * @returns Node and outcome.
 * @example
 * ```ts
 * splitEdge("dailyGift:claim"); // { node: "dailyGift", outcome: "claim" }
 * ```
 */
function splitEdge(text: string): { readonly node: string; readonly outcome: string } {
  const colon = text.indexOf(":");
  return { node: text.slice(0, colon), outcome: text.slice(colon + 1) };
}

/**
 * The item of one ELK child: a node, a stub or an exit port.
 *
 * @param flowName - The flow name.
 * @param flow - The flow.
 * @param classes - The DFS edge classes.
 * @param child - The laid-out ELK child.
 * @returns The item, or undefined for an unknown id.
 * @example
 * ```ts
 * itemOf("main", main, classes, { id: "n:home", x: 0, y: 0, width: 172, height: 44 });
 * ```
 */
function itemOf(
  flowName: string,
  flow: FlowJson,
  classes: ReadonlyMap<string, EdgeClass>,
  child: ElkNode
): Item | undefined {
  const base = { x: child.x ?? 0, y: child.y ?? 0, flow: flowName, pinned: false };

  if (child.id.startsWith(ID.node)) {
    const node = child.id.slice(ID.node.length);
    const ports: Record<string, number> = {};
    for (const port of child.ports ?? []) {
      if (port.id.startsWith(ID.port))
        ports[splitEdge(port.id.slice(ID.port.length)).outcome] = port.y ?? 0;
    }
    const id = `${flowName}/${node}`;
    return {
      ...base,
      key: id,
      id,
      kind: "node",
      w: child.width ?? NODE_W,
      h: child.height ?? NODE_H,
      ports
    };
  }

  if (child.id.startsWith(ID.stub)) {
    const { node, outcome } = splitEdge(child.id.slice(ID.stub.length));
    const target = targetNode(flow.edges[node]?.[outcome] ?? "") ?? "";
    const back = classes.get(`${node}:${outcome}`) === "back";
    return {
      ...base,
      key: `stub:${flowName}/${node}:${outcome}`,
      id: `${flowName}/${target}`,
      kind: "stub",
      w: STUB_W,
      h: STUB_H,
      label: back ? `↩ ${target}` : `→ ${target}`,
      target: `${flowName}/${target}`
    };
  }

  if (child.id.startsWith(ID.exit)) {
    const exit = child.id.slice(ID.exit.length);
    return {
      ...base,
      key: `exit:${exit}`,
      id: `${flowName}/exit:${exit}`,
      kind: "port",
      w: PORT,
      h: PORT,
      label: `exit:${exit}`
    };
  }
  return undefined;
}

/**
 * The local key of an ELK edge target.
 *
 * @param flowName - The flow name.
 * @param target - The ELK target id.
 * @param edgeId - The ELK edge id (for stubs).
 * @returns The item key.
 * @example
 * ```ts
 * targetKey("main", "in:board", "e:home:play"); // "main/board"
 * ```
 */
function targetKey(flowName: string, target: string, edgeId: string): string {
  if (target.startsWith(ID.entry)) return `${flowName}/${target.slice(ID.entry.length)}`;
  if (target.startsWith(ID.exit)) return `exit:${target.slice(ID.exit.length)}`;
  return `stub:${flowName}/${edgeId.slice(ID.edge.length)}`;
}

/**
 * The points of an ELK edge: start, bends, end of its first section.
 *
 * @param edge - The laid-out ELK edge.
 * @returns The points (empty without sections).
 * @example
 * ```ts
 * pointsOf(edge); // [{ x: 172, y: 22 }, { x: 322, y: 22 }]
 * ```
 */
function pointsOf(edge: ElkExtendedEdge): { x: number; y: number }[] {
  const [section] = edge.sections ?? [];
  if (section === undefined) return [];
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(point => ({
    x: point.x,
    y: point.y
  }));
}

/**
 * The edges of one ELK edge: the edge with ELK's points (extended onto a moved exit port, routed
 * when ELK gave no section) and, into a stub, the stub's return edge.
 *
 * @param flowName - The flow name.
 * @param edge - The laid-out ELK edge.
 * @param byKey - Items by local key.
 * @param exitX - x of the exit ports.
 * @returns One or two edges.
 * @example
 * ```ts
 * edgesOf("main", elkEdge, byKey, 1200);
 * ```
 */
function edgesOf(
  flowName: string,
  edge: ElkExtendedEdge,
  byKey: ReadonlyMap<string, Item>,
  exitX: number
): EdgePath[] {
  const { node, outcome } = splitEdge(edge.id.slice(ID.edge.length));
  const from = `${flowName}/${node}`;
  const to = targetKey(flowName, edge.targets[0] ?? "", edge.id);
  const fromItem = byKey.get(from);
  const toItem = byKey.get(to);
  let points = pointsOf(edge);
  const end = points.at(-1);
  if (toItem?.kind === "port" && end !== undefined) {
    toItem.y = end.y - PORT / 2;
    points = [...points, { x: exitX + PORT / 2, y: end.y }];
  }
  if (points.length === 0 && fromItem !== undefined && toItem !== undefined) {
    points = [...orthogonalRoute(anchorOut(fromItem, outcome), anchorIn(toItem))];
  }
  const edges: EdgePath[] = [
    { key: `${from}:${outcome}`, from, to, outcome, kind: "edge", points, label: outcome }
  ];
  const target =
    toItem?.kind === "stub" && toItem.target !== undefined ? byKey.get(toItem.target) : undefined;
  if (toItem !== undefined && target !== undefined) {
    edges.push({
      key: `${from}:${outcome}`,
      from: toItem.key,
      to: target.key,
      outcome,
      kind: "return",
      points: orthogonalRoute(anchorOut(toItem, outcome), anchorIn(target))
    });
  }
  return edges;
}

/**
 * Maps ELK's output back to a flow box: node, stub and exit items, edges with ELK's bend points,
 * the return edges of the stubs, exits moved onto the frame's right edge, the entry port.
 *
 * @param flowName - The flow name.
 * @param flow - The flow.
 * @param classes - The DFS edge classes.
 * @param output - ELK's laid-out graph.
 * @returns The flow box.
 * @example
 * ```ts
 * fromElkGraph("main", main, classes, await engine.layout(toElkGraph("main", main, classes))).items.length;
 * ```
 */
export function fromElkGraph(
  flowName: string,
  flow: FlowJson,
  classes: ReadonlyMap<string, EdgeClass>,
  output: ElkNode
): FlowBox {
  const items = (output.children ?? []).flatMap(
    child => itemOf(flowName, flow, classes, child) ?? []
  );
  const content = items.filter(entry => entry.kind !== "port");
  const left = Math.min(0, ...content.map(entry => entry.x));
  const top = Math.min(0, ...content.map(entry => entry.y));
  const right = Math.max(0, ...content.map(entry => entry.x + entry.w));
  const bottom = Math.max(0, ...content.map(entry => entry.y + entry.h));
  const exitX = right + FRAME_PAD - PORT / 2;
  for (const port of items) if (port.kind === "port") port.x = exitX;

  const byKey = new Map(items.map(entry => [entry.key, entry]));
  const edges = (output.edges ?? []).flatMap(edge => edgesOf(flowName, edge, byKey, exitX));
  const start = byKey.get(`${flowName}/${flow.start}`);
  items.push({
    key: "entry",
    id: `${flowName}/entry`,
    kind: "port",
    x: left - FRAME_PAD - PORT / 2,
    y: (start === undefined ? top : start.y + start.h / 2) - PORT / 2,
    w: PORT,
    h: PORT,
    flow: flowName,
    pinned: false,
    label: "entry"
  });

  return {
    items,
    edges,
    lanes: [],
    heads: [],
    bounds: { x: left, y: top, w: right - left, h: bottom - top },
    unreached: []
  };
}
