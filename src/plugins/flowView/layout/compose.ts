/**
 * @file flowView layout module — the composition: recursive frames bottom-up (expanded sub-flow
 * and slot items become fixed-size boxes with entry and exit ports), hub-lane or ELK layout per
 * flow, the pins overlay, world coordinates with instance keys (items and edges), edges across
 * frames. Deterministic: same input, same result.
 */
import type {
  EdgePath,
  FlowJson,
  GraphJson,
  GraphNodeJson,
  Item,
  ItemKey,
  LayoutResult,
  Rect
} from "../types";
import { classifyEdges } from "./back-edges";
import { fromElkGraph, toElkGraph } from "./elk-graph";
import { detectHub } from "./hub";
import { layoutLanes, UNREACHED_GAP } from "./lanes";
import { anchorIn, anchorOut, orthogonalRoute, rerouted } from "./routes";
import type { ComposeInput, FlowBox, PinsFile } from "./types";
import { FRAME_HEAD, FRAME_PAD, NODE_H, NODE_W, PORT } from "./types";

/**
 * One laid-out flow and the flows laid out inside its expanded nodes.
 */
type Placed = {
  readonly flowName: string;
  readonly box: FlowBox;
  /** Node name → the child flows of that expanded node (one, or the contributions of a slot). */
  readonly children: ReadonlyMap<string, readonly Placed[]>;
};

/**
 * What the flattening collects.
 */
type Flat = {
  readonly items: Item[];
  readonly edges: EdgePath[];
  readonly lanes: LayoutResult["lanes"];
  readonly heads: LayoutResult["heads"];
  readonly frames: Item[];
  readonly origins: Record<string, { x: number; y: number }>;
};

/**
 * Deepest nesting of expanded frames.
 */
const MAX_DEPTH = 8;

/**
 * Gap between the contribution flows stacked in a slot frame.
 */
const SLOT_GAP = 24;

/**
 * The instance key of an item: the local key in the root frame, "<prefix>>" + local inside a frame.
 *
 * @param prefix - The frame key ("" for the root frame).
 * @param local - The local key (a node id, a stub or a port).
 * @returns The instance key.
 * @example
 * ```ts
 * instanceKey("main/board", "board/merge"); // "main/board>board/merge"
 * ```
 */
export function instanceKey(prefix: string, local: string): ItemKey {
  return prefix === "" ? local : `${prefix}>${local}`;
}

/**
 * The key of a flow's content origin in `LayoutResult.origins`.
 *
 * @param frame - The frame key.
 * @param flow - The flow laid out in it.
 * @returns "<frame>|<flow>".
 * @example
 * ```ts
 * originKey("#main", "main"); // "#main|main"
 * ```
 */
export function originKey(frame: ItemKey, flow: string): string {
  return `${frame}|${flow}`;
}

/**
 * The flows an expanded node opens: its sub-flow, or a slot's contributions by order.
 *
 * @param graph - The graph.
 * @param node - The node.
 * @returns Flow names that exist in the graph.
 */
export function childFlows(graph: GraphJson, node: GraphNodeJson): string[] {
  const flows =
    node.subFlow === undefined
      ? (graph.slots[node.slot ?? ""] ?? [])
          .toSorted((a, b) => a.order - b.order)
          .map(entry => entry.flow)
      : [node.subFlow];
  return flows.filter(flow => graph.flows[flow] !== undefined);
}

/**
 * The bounds of the content items (ports left out).
 *
 * @param items - Items.
 * @returns The rect (an empty card when nothing is there).
 * @example
 * ```ts
 * contentBounds([]); // { x: 0, y: 0, w: 172, h: 44 }
 * ```
 */
function contentBounds(items: readonly Item[]): Rect {
  const content = items.filter(entry => entry.kind !== "port");
  if (content.length === 0) return { x: 0, y: 0, w: NODE_W, h: NODE_H };
  const left = Math.min(0, ...content.map(entry => entry.x));
  const top = Math.min(0, ...content.map(entry => entry.y));
  const right = Math.max(...content.map(entry => entry.x + entry.w));
  const bottom = Math.max(...content.map(entry => entry.y + entry.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * An edge moved by a delta: its points and its label centre.
 *
 * @param edge - The edge.
 * @param dx - Delta x.
 * @param dy - Delta y.
 * @returns The moved edge.
 * @example
 * ```ts
 * movedEdge({ ...edge, points: [{ x: 0, y: 0 }], labelAt: { x: 5, y: 0 } }, 10, 20).labelAt; // { x: 15, y: 20 }
 * ```
 */
function movedEdge(edge: EdgePath, dx: number, dy: number): EdgePath {
  const moved: EdgePath = {
    ...edge,
    points: edge.points.map(point => ({ x: point.x + dx, y: point.y + dy }))
  };
  if (edge.labelAt !== undefined)
    moved.labelAt = { x: edge.labelAt.x + dx, y: edge.labelAt.y + dy };
  return moved;
}

/**
 * Moves a box by a delta.
 *
 * @param box - The box.
 * @param dx - Delta x.
 * @param dy - Delta y.
 * @returns The moved items and edges.
 */
function shift(
  box: FlowBox,
  dx: number,
  dy: number
): { readonly items: Item[]; readonly edges: EdgePath[] } {
  return {
    items: box.items.map(entry => ({ ...entry, x: entry.x + dx, y: entry.y + dy })),
    edges: box.edges.map(edge => movedEdge(edge, dx, dy))
  };
}

/**
 * The source node key of a stub key "stub:<id>:<outcome>".
 *
 * @param key - The stub key.
 * @returns The node id.
 * @example
 * ```ts
 * stubSource("stub:main/dailyGift:claim"); // "main/dailyGift"
 * ```
 */
function stubSource(key: string): string {
  return key.slice("stub:".length, key.lastIndexOf(":"));
}

/**
 * Re-routes every edge that touches one of the keys with the 3-segment route.
 *
 * @param edges - The edges.
 * @param items - The items (moved ones at their new place).
 * @param keys - The moved keys.
 * @returns The edges.
 * @example
 * ```ts
 * reroute(box.edges, items, new Set(["main/home"]));
 * ```
 */
function reroute(
  edges: readonly EdgePath[],
  items: readonly Item[],
  keys: ReadonlySet<string>
): EdgePath[] {
  if (keys.size === 0) return [...edges];
  const byKey = new Map(items.map(entry => [entry.key, entry]));
  return edges.map(edge => {
    if (!keys.has(edge.from) && !keys.has(edge.to ?? "")) return edge;
    const from = byKey.get(edge.from);
    const to = edge.to === undefined ? undefined : byKey.get(edge.to);
    if (from === undefined || to === undefined) return edge;
    return rerouted(edge, orthogonalRoute(anchorOut(from, edge.outcome), anchorIn(to)));
  });
}

/**
 * Puts the exit ports back on the right edge and the entry port on the left edge of the bounds.
 *
 * @param items - The items.
 * @param bounds - The content bounds.
 * @returns The keys of the ports that moved.
 */
function reseatPorts(items: Item[], bounds: Rect): Set<string> {
  const moved = new Set<string>();
  for (const port of items) {
    if (port.kind !== "port") continue;
    const x =
      port.key === "entry"
        ? bounds.x - FRAME_PAD - PORT / 2
        : bounds.x + bounds.w + FRAME_PAD - PORT / 2;
    if (port.x !== x) {
      port.x = x;
      moved.add(port.key);
    }
  }
  return moved;
}

/**
 * The pins overlay: a pinned node (or expanded box) takes its pin, its stubs move by the same
 * delta, touching edges re-route, the bounds grow, ports follow the edges of the bounds.
 *
 * @param box - The flow box.
 * @param pins - The pins.
 * @returns The box with pins applied.
 */
function applyPins(box: FlowBox, pins: PinsFile): FlowBox {
  const deltas = new Map<string, { dx: number; dy: number }>();
  let items = box.items.map(entry => {
    const pin = pins.nodes[entry.key];
    if (entry.kind !== "node" || pin === undefined) return entry;
    deltas.set(entry.key, { dx: pin.x - entry.x, dy: pin.y - entry.y });
    return { ...entry, x: pin.x, y: pin.y, pinned: true };
  });
  if (deltas.size === 0) return box;

  const moved = new Set(deltas.keys());
  items = items.map(entry => {
    const delta = entry.kind === "stub" ? deltas.get(stubSource(entry.key)) : undefined;
    if (delta === undefined) return entry;
    moved.add(entry.key);
    return { ...entry, x: entry.x + delta.dx, y: entry.y + delta.dy };
  });

  const bounds = contentBounds(items);
  for (const key of reseatPorts(items, bounds)) moved.add(key);
  return { ...box, items, edges: reroute(box.edges, items, moved), bounds };
}

/**
 * Lays out the nodes a hub-lane walk did not reach as an ELK block under the lanes.
 *
 * @param input - The compose input.
 * @param flowName - The flow name.
 * @param flow - The flow.
 * @param lanes - The hub-lane box.
 * @param sizes - Expanded box sizes.
 * @returns The box with the block merged.
 * @example
 * ```ts
 * await withUnreached(input, "board", board, lanes, sizes);
 * ```
 */
async function withUnreached(
  input: ComposeInput,
  flowName: string,
  flow: FlowJson,
  lanes: FlowBox,
  sizes: ReadonlyMap<string, { w: number; h: number }>
): Promise<FlowBox> {
  if (lanes.unreached.length === 0) return lanes;
  const classes = classifyEdges(flow);
  const graph = toElkGraph(flowName, flow, classes, {
    sizes,
    only: new Set(lanes.unreached),
    ...(input.density === undefined ? {} : { density: input.density })
  });
  const block = fromElkGraph(flowName, flow, classes, await input.engine.layout(graph));
  const known = new Set(lanes.items.map(entry => entry.key));
  const moved = shift(block, -block.bounds.x, lanes.bounds.h + UNREACHED_GAP - block.bounds.y);
  const items = [...lanes.items, ...moved.items.filter(entry => !known.has(entry.key))];
  const bounds = contentBounds(items);
  const ports = reseatPorts(items, bounds);
  return {
    ...lanes,
    items,
    edges: reroute([...lanes.edges, ...moved.edges], items, ports),
    bounds,
    unreached: []
  };
}

/**
 * The box of a flow the graph does not have: no items, the bounds of an empty card.
 *
 * @returns The empty box.
 * @example
 * ```ts
 * emptyBox().bounds; // { x: 0, y: 0, w: 172, h: 44 }
 * ```
 */
function emptyBox(): FlowBox {
  return { items: [], edges: [], lanes: [], heads: [], bounds: contentBounds([]), unreached: [] };
}

/**
 * The size of an expanded node's frame: the widest child flow plus the padding, the child flows
 * stacked under the frame head with SLOT_GAP between them.
 *
 * @param inner - The bounds of the child flows, top to bottom.
 * @returns Width and height.
 * @example
 * ```ts
 * frameSize([{ x: 0, y: 0, w: 172, h: 44 }]); // { w: 216, h: 106 }
 * ```
 */
function frameSize(inner: readonly Rect[]): { w: number; h: number } {
  return {
    w: Math.max(...inner.map(rect => rect.w)) + 2 * FRAME_PAD,
    h:
      FRAME_HEAD +
      inner.reduce((sum, rect) => sum + rect.h, 0) +
      SLOT_GAP * (inner.length - 1) +
      FRAME_PAD
  };
}

/**
 * Lays out the child flows of a flow's expanded nodes (down to MAX_DEPTH) and the frame size each
 * expanded node gets.
 *
 * @param input - The compose input.
 * @param flowName - The flow name.
 * @param flow - The flow.
 * @param prefix - The frame key the flow is laid out in ("" for the root).
 * @param depth - Nesting depth of the flow.
 * @returns Frame sizes and child flows, by node name.
 */
async function layoutChildren(
  input: ComposeInput,
  flowName: string,
  flow: FlowJson,
  prefix: string,
  depth: number
): Promise<{ sizes: Map<string, { w: number; h: number }>; children: Map<string, Placed[]> }> {
  const sizes = new Map<string, { w: number; h: number }>();
  const children = new Map<string, Placed[]>();
  for (const [name, node] of Object.entries(flow.nodes)) {
    const key = instanceKey(prefix, `${flowName}/${name}`);
    if (depth >= MAX_DEPTH || !input.expanded.has(key)) continue;
    const placed: Placed[] = [];
    for (const child of childFlows(input.graph, node)) {
      placed.push(await layoutFlow(input, child, key, depth + 1));
    }
    if (placed.length === 0) continue;
    children.set(name, placed);
    sizes.set(name, frameSize(placed.map(entry => entry.box.bounds)));
  }
  return { sizes, children };
}

/**
 * Lays out the nodes of one flow: around its hub (plus an ELK block for the nodes the lanes do not
 * reach), else with ELK.
 *
 * @param input - The compose input.
 * @param flowName - The flow name.
 * @param flow - The flow.
 * @param sizes - Frame sizes of the expanded nodes.
 * @returns The flow box.
 */
async function layoutNodes(
  input: ComposeInput,
  flowName: string,
  flow: FlowJson,
  sizes: ReadonlyMap<string, { w: number; h: number }>
): Promise<FlowBox> {
  const hub = detectHub(flow, input.config);
  if (hub !== undefined) {
    return withUnreached(input, flowName, flow, layoutLanes(flowName, flow, hub, sizes), sizes);
  }
  const classes = classifyEdges(flow);
  const options = input.density === undefined ? { sizes } : { sizes, density: input.density };
  const output = await input.engine.layout(toElkGraph(flowName, flow, classes, options));
  return fromElkGraph(flowName, flow, classes, output);
}

/**
 * Lays out one flow: first the flows inside its expanded nodes, then its own nodes, then the pins.
 *
 * @param input - The compose input.
 * @param flowName - The flow name.
 * @param prefix - The frame key the flow is laid out in ("" for the root).
 * @param depth - Nesting depth.
 * @returns The placed flow.
 * @example
 * ```ts
 * await layoutFlow(input, "main", "", 0);
 * ```
 */
async function layoutFlow(
  input: ComposeInput,
  flowName: string,
  prefix: string,
  depth: number
): Promise<Placed> {
  const flow = input.graph.flows[flowName];
  if (flow === undefined) return { flowName, box: emptyBox(), children: new Map() };

  const { sizes, children } = await layoutChildren(input, flowName, flow, prefix, depth);
  const box = await layoutNodes(input, flowName, flow, sizes);
  return { flowName, box: applyPins(box, input.pins), children };
}

/**
 * The child flows laid out inside a local item: set for an expanded node only.
 *
 * @param placed - The placed flow the item belongs to.
 * @param local - A local item of that flow.
 * @returns The child flows, or undefined when the item is not expanded.
 */
function nestedFlows(placed: Placed, local: Item): readonly Placed[] | undefined {
  if (local.kind !== "node") return undefined;
  return placed.children.get(local.id.slice(placed.flowName.length + 1));
}

/**
 * Stacks the child flows of an expanded node inside its frame: top to bottom under the frame
 * head, SLOT_GAP apart, each flattened at its own content origin.
 *
 * @param frame - The frame item, already at world coordinates.
 * @param children - The child flows.
 * @param flat - The flat result.
 */
function flattenFrame(frame: Item, children: readonly Placed[], flat: Flat): void {
  flat.frames.push(frame);
  let top = frame.y + FRAME_HEAD;
  for (const child of children) {
    const origin = { x: frame.x + FRAME_PAD - child.box.bounds.x, y: top - child.box.bounds.y };
    flatten(child, origin, frame.key, frame.key, flat);
    top += child.box.bounds.h + SLOT_GAP;
  }
}

/**
 * Adds the edges, lane bands and column heads of a flow box at a content origin; edge keys get the
 * instance prefix like their ends, so an edge key is unique per instance.
 *
 * @param box - The flow box.
 * @param origin - World point of its content origin.
 * @param origin.x - World x.
 * @param origin.y - World y.
 * @param prefix - Its frame key ("" for the root flow).
 * @param flat - The flat result.
 */
function flattenPaths(
  box: FlowBox,
  origin: { readonly x: number; readonly y: number },
  prefix: string,
  flat: Flat
): void {
  for (const edge of box.edges) {
    const to = edge.to === undefined ? undefined : instanceKey(prefix, edge.to);
    flat.edges.push({
      ...movedEdge(edge, origin.x, origin.y),
      key: instanceKey(prefix, edge.key),
      from: instanceKey(prefix, edge.from),
      to
    });
  }
  for (const lane of box.lanes) {
    flat.lanes.push({ ...lane, x: origin.x + lane.x, y: origin.y + lane.y });
  }
  for (const head of box.heads) {
    flat.heads.push({ ...head, x: origin.x + head.x, y: origin.y + head.y });
  }
}

/**
 * Adds a placed flow to the flat result at a content origin, recursing into expanded frames.
 *
 * @param placed - The placed flow.
 * @param origin - World point of its content origin.
 * @param origin.x - World x.
 * @param origin.y - World y.
 * @param prefix - Its frame key ("" for the root flow).
 * @param frame - The key of the frame item it sits in.
 * @param flat - The flat result.
 */
function flatten(
  placed: Placed,
  origin: { readonly x: number; readonly y: number },
  prefix: string,
  frame: ItemKey,
  flat: Flat
): void {
  flat.origins[originKey(frame, placed.flowName)] = { x: origin.x, y: origin.y };

  // Items at world coordinates and instance keys; an expanded node becomes a frame.
  for (const local of placed.box.items) {
    const nested = nestedFlows(placed, local);
    const item: Item = {
      ...local,
      key: instanceKey(prefix, local.key),
      kind: nested === undefined ? local.kind : "frame",
      x: origin.x + local.x,
      y: origin.y + local.y,
      parent: frame
    };
    flat.items.push(item);
    if (nested !== undefined) flattenFrame(item, nested, flat);
  }

  flattenPaths(placed.box, origin, prefix, flat);
}

/**
 * Re-routes the edges that leave or enter an expanded frame through its exit and entry ports.
 *
 * @param flat - The flat result.
 */
function routeFrames(flat: Flat): void {
  const byKey = new Map(flat.items.map(entry => [entry.key, entry]));
  for (const [index, edge] of flat.edges.entries()) {
    const from = byKey.get(edge.from);
    const to = edge.to === undefined ? undefined : byKey.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from.kind !== "frame" && to.kind !== "frame") continue;

    const exit = from.kind === "frame" ? byKey.get(`${from.key}>exit:${edge.outcome}`) : undefined;
    const entry = to.kind === "frame" ? byKey.get(`${to.key}>entry`) : undefined;
    const start = exit === undefined ? anchorOut(from, edge.outcome) : anchorIn(exit);
    const end = anchorIn(entry ?? to);
    flat.edges[index] = rerouted(edge, orthogonalRoute(start, end));
  }
}

/**
 * Grows a frame to contain items (plus the frame padding).
 *
 * @param frame - The frame item.
 * @param items - Items that must fit.
 */
function grow(frame: Item, items: readonly Item[]): void {
  for (const entry of items) {
    if (entry === frame || entry.kind === "port") continue;
    frame.w = Math.max(frame.w, entry.x + entry.w + FRAME_PAD - frame.x);
    frame.h = Math.max(frame.h, entry.y + entry.h + FRAME_PAD - frame.y);
  }
}

/**
 * Lays out the graph from a root flow: frames, hub lanes or ELK, pins.
 *
 * @param input - Graph, root, expanded set, pins, config, the ELK engine and the density.
 * @returns The layout result in world coordinates.
 * @example
 * ```ts
 * const result = await composeLayout({ graph, root: "main", expanded: new Set(["main/board"]), pins, config, engine });
 * result.byKey["main/board>board/awaitIntent"]?.kind; // "hub"
 * ```
 */
export async function composeLayout(input: ComposeInput): Promise<LayoutResult> {
  const placed = await layoutFlow(input, input.root, "", 0);
  const { bounds } = placed.box;
  const root: Item = {
    key: `#${input.root}`,
    id: input.root,
    kind: "frame",
    x: 0,
    y: 0,
    w: bounds.w + 2 * FRAME_PAD,
    h: bounds.h + FRAME_HEAD + FRAME_PAD,
    flow: input.root,
    pinned: false,
    label: `# ${input.root}`
  };
  const flat: Flat = {
    items: [root],
    edges: [],
    lanes: [],
    heads: [],
    frames: [root],
    origins: {}
  };
  flatten(placed, { x: FRAME_PAD - bounds.x, y: FRAME_HEAD - bounds.y }, "", root.key, flat);
  routeFrames(flat);
  grow(root, flat.items);

  return {
    root: input.root,
    items: flat.items,
    byKey: Object.fromEntries(flat.items.map(entry => [entry.key, entry])),
    edges: flat.edges,
    lanes: flat.lanes,
    heads: flat.heads,
    bounds: { x: root.x, y: root.y, w: root.w, h: root.h },
    frames: flat.frames,
    origins: flat.origins
  };
}
