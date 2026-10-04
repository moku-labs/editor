/**
 * @file flowView layout module — the ELK input of a non-hub flow (design §7.6: nodes with
 * FIXED_ORDER east ports that grow tall enough for their ports, back edges as 120×24 stub nodes,
 * exits in the last layer, every edge with its outcome label sized for ELK to place) and the
 * mapping of ELK's output back to items, edges and label centres.
 */
import type { ElkExtendedEdge, ElkLabel, ElkNode, ElkPort, LayoutOptions } from "elkjs";
import type { Density } from "../../workspace/types";
import type { EdgePath, FlowJson, Item, Rect } from "../types";
import { exitOf, targetNode } from "./back-edges";
import { anchorIn, anchorOut, orthogonalRoute } from "./routes";
import type { EdgeClass, FlowBox, NodeSizes } from "./types";
import {
  COL_GAP,
  DENSITY_SPACING,
  FRAME_PAD,
  LABEL_H,
  labelWidth,
  NODE_H,
  NODE_SPACING,
  NODE_W,
  PORT,
  STUB_H,
  STUB_W
} from "./types";

/**
 * The ELK options of every non-hub flow (spec layout/ §4), seed 1 for determinism; edge labels in
 * the centre of their edge with room around them (finding 11).
 */
export const ELK_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": String(COL_GAP),
  "elk.spacing.nodeNode": String(NODE_SPACING),
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.portConstraints": "FIXED_ORDER",
  "elk.edgeLabels.placement": "CENTER",
  "elk.spacing.edgeLabel": "4",
  "elk.spacing.labelNode": "6",
  "elk.spacing.portPort": "22",
  "elk.spacing.edgeEdge": "10",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
  "elk.randomSeed": "1",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]"
};

/**
 * What `toElkGraph` lays out beyond the flow itself.
 *
 * @example
 * ```ts
 * const options: ElkGraphOptions = { sizes: new Map([["board", { w: 900, h: 700 }]]), density: "compact" };
 * ```
 */
export type ElkGraphOptions = {
  /** Sizes of expanded boxes by node name. */
  readonly sizes?: NodeSizes;
  /** Lay out only these nodes (the unreached block of a hub flow). */
  readonly only?: ReadonlySet<string>;
  /** The applied density: its spacing replaces the base COL_GAP / NODE_SPACING. */
  readonly density?: Density;
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
 * The label of an edge, sized like the chip the canvas draws.
 *
 * @param id - The ELK edge id.
 * @param outcome - The outcome it is labelled with.
 * @returns The ELK labels.
 * @example
 * ```ts
 * labelsOf("e:home:play", "play"); // [{ id: "e:home:play:l", text: "play", width: 38.4, height: 18 }]
 * ```
 */
function labelsOf(id: string, outcome: string): ElkLabel[] {
  return [{ id: `${id}:l`, text: outcome, width: labelWidth(outcome), height: LABEL_H }];
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
  const labels = labelsOf(id, outcome);
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
    build.edges.push({ id, sources: [source], targets: [`${ID.exit}${exit}`], labels });
    return;
  }
  if (target === undefined || build.flow.nodes[target] === undefined) return;
  const isStub = build.classes.get(`${node}:${outcome}`) === "back" || !included(build, target);
  if (isStub) {
    build.children.push({ id: `${ID.stub}${node}:${outcome}`, width: STUB_W, height: STUB_H });
    build.edges.push({
      id,
      sources: [source],
      targets: [`${ID.stub}${node}:${outcome}`],
      labels
    });
  } else {
    build.edges.push({ id, sources: [source], targets: [`${ID.entry}${target}`], labels });
  }
}

/**
 * The ELK options of a flow at a density: the base options, the density's spacing when one is
 * applied. Every edge carries its label (finding 11) and ELK puts the centred labels in a layer of
 * their own between two node layers, so the layer gap is spent twice: half the density gap each
 * side keeps the flow as wide as it was before the labels.
 *
 * @param density - The applied density, if any.
 * @returns The layout options.
 * @example
 * ```ts
 * elkOptions("compact")["elk.spacing.nodeNode"]; // "14"
 * elkOptions("comfortable")["elk.layered.spacing.nodeNodeBetweenLayers"]; // "60"
 * ```
 */
export function elkOptions(density?: Density): LayoutOptions {
  if (density === undefined) return { ...ELK_OPTIONS };
  const spacing = DENSITY_SPACING[density];
  return {
    ...ELK_OPTIONS,
    "elk.layered.spacing.nodeNodeBetweenLayers": String(spacing.layers / 2),
    "elk.spacing.nodeNode": String(spacing.nodes)
  };
}

/**
 * Builds the ELK input of a flow: every node (card size, or its expanded box, growing tall enough
 * for its ports), every forward and short-loop edge with its label, one stub node per back edge
 * (or per edge leaving the `only` subset), exits as small nodes in the last layer.
 *
 * @param flowName - The flow name.
 * @param flow - The flow.
 * @param classes - The DFS edge classes.
 * @param options - Expanded box sizes, the subset to lay out and the density.
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
  options: ElkGraphOptions = {}
): ElkNode {
  const { sizes = new Map(), only, density } = options;
  const build: ElkBuild = { flow, classes, only, children: [], edges: [], exits: new Set() };
  const nodes = Object.entries(flow.nodes).filter(([node]) => included(build, node));
  for (const [node, info] of nodes) {
    const size = sizes.get(node) ?? { w: NODE_W, h: NODE_H };
    build.children.push({
      id: `${ID.node}${node}`,
      width: size.w,
      height: size.h,
      layoutOptions: {
        "elk.portConstraints": "FIXED_ORDER",
        "elk.nodeSize.constraints": "[PORTS, MINIMUM_SIZE]",
        "elk.nodeSize.minimum": `(${size.w}, ${size.h})`
      },
      ports: portsOf(node, info.outcomes)
    });
  }
  for (const [node, info] of nodes)
    for (const outcome of info.outcomes) addEdge(build, node, outcome);
  return {
    id: flowName,
    layoutOptions: elkOptions(density),
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
 * pointsOf({
 *   id: "e:home:play",
 *   sources: ["home"],
 *   targets: ["board"],
 *   sections: [{ id: "s0", startPoint: { x: 172, y: 22 }, endPoint: { x: 322, y: 22 } }]
 * }); // [{ x: 172, y: 22 }, { x: 322, y: 22 }]
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
 * The box of the label ELK placed on an edge.
 *
 * @param edge - The laid-out ELK edge.
 * @returns The rect, or undefined when ELK placed no label.
 * @example
 * ```ts
 * labelBox({ id: "e:a:b", sources: [], targets: [], labels: [{ id: "l", x: 10, y: 20, width: 40, height: 18 }] }); // { x: 10, y: 20, w: 40, h: 18 }
 * ```
 */
function labelBox(edge: ElkExtendedEdge): Rect | undefined {
  const [label] = edge.labels ?? [];
  if (label?.x === undefined || label.y === undefined) return undefined;
  return { x: label.x, y: label.y, w: label.width ?? 0, h: label.height ?? 0 };
}

/**
 * The centre of the label ELK placed on an edge.
 *
 * @param edge - The laid-out ELK edge.
 * @returns The point, or undefined when ELK placed no label.
 * @example
 * ```ts
 * labelCentre({ id: "e:a:b", sources: [], targets: [], labels: [{ id: "l", x: 10, y: 20, width: 40, height: 18 }] }); // { x: 30, y: 29 }
 * ```
 */
function labelCentre(edge: ElkExtendedEdge): { x: number; y: number } | undefined {
  const box = labelBox(edge);
  return box === undefined ? undefined : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * The edges of one ELK edge: the edge with ELK's points (extended onto a moved exit port, routed
 * when ELK gave no section) and its label centre and, into a stub, the stub's return edge.
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
  const labelAt = points.length === 0 ? undefined : labelCentre(edge);
  const end = points.at(-1);
  if (toItem?.kind === "port" && end !== undefined) {
    toItem.y = end.y - PORT / 2;
    points = [...points, { x: exitX + PORT / 2, y: end.y }];
  }
  if (points.length === 0 && fromItem !== undefined && toItem !== undefined) {
    points = [...orthogonalRoute(anchorOut(fromItem, outcome), anchorIn(toItem))];
  }
  const main: EdgePath = {
    key: `${from}:${outcome}`,
    from,
    to,
    outcome,
    kind: "edge",
    points,
    label: outcome
  };
  if (labelAt !== undefined) main.labelAt = labelAt;
  const edges: EdgePath[] = [main];
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
 * Maps ELK's output back to a flow box: node, stub and exit items, edges with ELK's bend points
 * and label centres, the return edges of the stubs, exits moved onto the frame's right edge past
 * the labels, the entry port.
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
  // The content: the items and the label boxes ELK placed (exits sit past both).
  const content: Rect[] = [
    ...items.filter(entry => entry.kind !== "port"),
    ...(output.edges ?? []).flatMap(edge => labelBox(edge) ?? [])
  ];
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
