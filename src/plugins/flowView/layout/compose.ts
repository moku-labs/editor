/**
 * @file flowView layout module — the composition: recursive frames bottom-up (expanded sub-flow
 * and slot items become fixed-size boxes with entry and exit ports), hub-lane or ELK layout per
 * flow, the pins overlay, world coordinates with instance keys, edges across frames, notes beside
 * their anchors. Deterministic: same input, same result.
 */
import type {
  EdgePath,
  FlowJson,
  GraphJson,
  GraphNodeJson,
  Item,
  ItemKey,
  LayoutResult,
  NoteAnchor,
  Rect
} from "../types";
import { classifyEdges } from "./back-edges";
import { fromElkGraph, toElkGraph } from "./elk-graph";
import { detectHub } from "./hub";
import { layoutLanes, UNREACHED_GAP } from "./lanes";
import { anchorIn, anchorOut, orthogonalRoute } from "./routes";
import type { ComposeInput, FlowBox, PinsFile } from "./types";
import { FRAME_HEAD, FRAME_PAD, NODE_H, NODE_W, NOTE_H, NOTE_W, PORT, SNAP } from "./types";

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
 * How far a note sits right of and below its anchor.
 */
const NOTE_OFFSET = { x: 54, y: 3 } as const;

/**
 * Space between free notes under the root content.
 */
const NOTE_GAP = 48;

/**
 * Collision steps of a note before it stays where it is.
 */
const NOTE_STEPS = 50;

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
 * @example
 * ```ts
 * childFlows(graph, graph.flows.main.nodes.afterOrder); // ["rewardPopup"]
 * ```
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
 * The bounds of the content items (ports and notes left out).
 *
 * @param items - Items.
 * @returns The rect (an empty card when nothing is there).
 * @example
 * ```ts
 * contentBounds(box.items); // { x: 0, y: 0, w: 1080, h: 934 }
 * ```
 */
function contentBounds(items: readonly Item[]): Rect {
  const content = items.filter(entry => entry.kind !== "port" && entry.kind !== "note");
  if (content.length === 0) return { x: 0, y: 0, w: NODE_W, h: NODE_H };
  const left = Math.min(0, ...content.map(entry => entry.x));
  const top = Math.min(0, ...content.map(entry => entry.y));
  const right = Math.max(...content.map(entry => entry.x + entry.w));
  const bottom = Math.max(...content.map(entry => entry.y + entry.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Moves a box by a delta.
 *
 * @param box - The box.
 * @param dx - Delta x.
 * @param dy - Delta y.
 * @returns The moved items and edges.
 * @example
 * ```ts
 * shift(block, 0, 982);
 * ```
 */
function shift(
  box: FlowBox,
  dx: number,
  dy: number
): { readonly items: Item[]; readonly edges: EdgePath[] } {
  return {
    items: box.items.map(entry => ({ ...entry, x: entry.x + dx, y: entry.y + dy })),
    edges: box.edges.map(edge => ({
      ...edge,
      points: edge.points.map(point => ({ x: point.x + dx, y: point.y + dy }))
    }))
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
    return { ...edge, points: orthogonalRoute(anchorOut(from, edge.outcome), anchorIn(to)) };
  });
}

/**
 * Puts the exit ports back on the right edge and the entry port on the left edge of the bounds.
 *
 * @param items - The items.
 * @param bounds - The content bounds.
 * @returns The keys of the ports that moved.
 * @example
 * ```ts
 * const moved = reseatPorts(items, bounds);
 * ```
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
 * @example
 * ```ts
 * applyPins(box, pins);
 * ```
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
  const graph = toElkGraph(flowName, flow, classes, sizes, new Set(lanes.unreached));
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
 * Lays out one flow (and, first, the flows inside its expanded nodes).
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
  if (flow === undefined) {
    return {
      flowName,
      box: { items: [], edges: [], lanes: [], heads: [], bounds: contentBounds([]), unreached: [] },
      children: new Map()
    };
  }

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
    const inner = placed.map(entry => entry.box.bounds);
    sizes.set(name, {
      w: Math.max(...inner.map(rect => rect.w)) + 2 * FRAME_PAD,
      h:
        FRAME_HEAD +
        inner.reduce((sum, rect) => sum + rect.h, 0) +
        SLOT_GAP * (inner.length - 1) +
        FRAME_PAD
    });
  }

  const hub = detectHub(flow, input.config);
  let box: FlowBox;
  if (hub === undefined) {
    const classes = classifyEdges(flow);
    const output = await input.engine.layout(toElkGraph(flowName, flow, classes, sizes));
    box = fromElkGraph(flowName, flow, classes, output);
  } else {
    box = await withUnreached(
      input,
      flowName,
      flow,
      layoutLanes(flowName, flow, hub, sizes),
      sizes
    );
  }
  return { flowName, box: applyPins(box, input.pins), children };
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
 * @example
 * ```ts
 * flatten(placed, { x: 22, y: 40 }, "", "#main", flat);
 * ```
 */
function flatten(
  placed: Placed,
  origin: { readonly x: number; readonly y: number },
  prefix: string,
  frame: ItemKey,
  flat: Flat
): void {
  flat.origins[originKey(frame, placed.flowName)] = { x: origin.x, y: origin.y };

  for (const local of placed.box.items) {
    const key = instanceKey(prefix, local.key);
    const nested =
      local.kind === "node"
        ? placed.children.get(local.id.slice(placed.flowName.length + 1))
        : undefined;
    const item: Item = {
      ...local,
      key,
      kind: nested === undefined ? local.kind : "frame",
      x: origin.x + local.x,
      y: origin.y + local.y,
      parent: frame
    };
    flat.items.push(item);
    if (nested === undefined) continue;

    flat.frames.push(item);
    let top = item.y + FRAME_HEAD;
    for (const child of nested) {
      const childOrigin = {
        x: item.x + FRAME_PAD - child.box.bounds.x,
        y: top - child.box.bounds.y
      };
      flatten(child, childOrigin, key, key, flat);
      top += child.box.bounds.h + SLOT_GAP;
    }
  }

  for (const edge of placed.box.edges) {
    const to = edge.to === undefined ? undefined : instanceKey(prefix, edge.to);
    flat.edges.push({
      ...edge,
      from: instanceKey(prefix, edge.from),
      to,
      points: edge.points.map(point => ({ x: origin.x + point.x, y: origin.y + point.y }))
    });
  }
  for (const lane of placed.box.lanes) {
    flat.lanes.push({ ...lane, x: origin.x + lane.x, y: origin.y + lane.y });
  }
  for (const head of placed.box.heads) {
    flat.heads.push({ ...head, x: origin.x + head.x, y: origin.y + head.y });
  }
}

/**
 * Re-routes the edges that leave or enter an expanded frame through its exit and entry ports.
 *
 * @param flat - The flat result.
 * @example
 * ```ts
 * routeFrames(flat);
 * ```
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
    flat.edges[index] = { ...edge, points: orthogonalRoute(start, end) };
  }
}

/**
 * True when two rects overlap.
 *
 * @param a - A rect.
 * @param b - A rect.
 * @returns Whether they overlap.
 * @example
 * ```ts
 * overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }); // true
 * ```
 */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Where an outcome note hangs: the right end of the outcome's stub, the hub port, or past the
 * edge label; for a node note the node's top-right corner.
 *
 * @param source - The source item.
 * @param outcome - The outcome, if any.
 * @param flat - The flat result.
 * @returns The anchor point.
 * @example
 * ```ts
 * anchorPoint(merge, "done", flat); // the right end of stub "↩ awaitIntent"
 * ```
 */
function anchorPoint(
  source: Item,
  outcome: string | undefined,
  flat: Flat
): { x: number; y: number } {
  if (outcome === undefined) return { x: source.x + source.w, y: source.y };
  const edge = flat.edges.find(
    entry => entry.kind === "edge" && entry.from === source.key && entry.outcome === outcome
  );
  const target = flat.items.find(entry => entry.key === edge?.to);
  if (target?.kind === "stub") return { x: target.x + target.w, y: target.y + target.h / 2 };
  if (source.kind === "hub") return anchorOut(source, outcome);
  const [first, second] = edge?.points ?? [];
  if (first !== undefined && second !== undefined) {
    return { x: (first.x + second.x) / 2 + 30, y: first.y };
  }
  return anchorOut(source, outcome);
}

/**
 * Where one note goes and what it hangs on.
 */
type NoteSpot = {
  readonly position: { readonly x: number; readonly y: number } | undefined;
  readonly source: Item | undefined;
  readonly point: { readonly x: number; readonly y: number } | undefined;
  readonly frame: Item | undefined;
  readonly flow: string | undefined;
  readonly pinned: boolean;
};

/**
 * The spot of one note: its pin (relative to the pinned flow's content origin), else beside its
 * anchor; a free note without a pin gets no position here (it goes under the root content).
 *
 * @param input - The compose input.
 * @param flat - The flat result.
 * @param anchor - The note anchor.
 * @returns The spot.
 * @example
 * ```ts
 * noteSpot(input, flat, { path: "a.md", flow: "board", from: { node: "board/merge", outcome: "done" }, title: "A" });
 * ```
 */
function noteSpot(input: ComposeInput, flat: Flat, anchor: NoteAnchor): NoteSpot {
  const pin = input.pins.notes[anchor.path];
  const frame =
    pin === undefined ? undefined : flat.frames.find(entry => originOf(flat, entry, pin.flow));
  const origin =
    pin === undefined || frame === undefined ? undefined : originOf(flat, frame, pin.flow);
  const from = anchor.from;
  const source =
    from === undefined
      ? undefined
      : flat.items.find(entry => entry.id === from.node && entry.kind !== "stub");
  const point = source === undefined ? undefined : anchorPoint(source, from?.outcome, flat);
  if (pin !== undefined && origin !== undefined) {
    return {
      position: { x: origin.x + pin.x, y: origin.y + pin.y },
      source,
      point,
      frame,
      flow: pin.flow,
      pinned: true
    };
  }
  const position =
    point === undefined ? undefined : { x: point.x + NOTE_OFFSET.x, y: point.y + NOTE_OFFSET.y };
  return { position, source, point, frame: undefined, flow: source?.flow, pinned: false };
}

/**
 * Places the notes: a pinned note at its pin, an outcome note beside its anchor, a free note under
 * the root content; collisions shift a note down by 12 (at most 50 steps). Anchored notes get a
 * dashed note edge.
 *
 * @param input - The compose input.
 * @param flat - The flat result.
 * @param root - The root frame.
 * @example
 * ```ts
 * placeNotes(input, flat, rootFrame);
 * ```
 */
function placeNotes(input: ComposeInput, flat: Flat, root: Item): void {
  const blockers: Rect[] = flat.items.filter(
    entry => entry.kind !== "frame" && entry.kind !== "port"
  );
  const rootOrigin = flat.origins[originKey(root.key, input.root)] ?? {
    x: FRAME_PAD,
    y: FRAME_HEAD
  };
  let freeY = root.y + root.h - FRAME_PAD + NOTE_GAP;

  for (const anchor of input.notes) {
    const spot = noteSpot(input, flat, anchor);
    let position = spot.position;
    if (position === undefined && anchor.from === undefined) {
      position = { x: rootOrigin.x, y: freeY };
      freeY += NOTE_H + NOTE_GAP;
    }
    if (position === undefined) continue;

    const note: Item = {
      key: `note:${anchor.path}`,
      id: anchor.path,
      kind: "note",
      x: position.x,
      y: position.y,
      w: NOTE_W,
      h: NOTE_H,
      flow: spot.flow ?? input.root,
      parent: spot.source?.parent ?? spot.frame?.key ?? root.key,
      pinned: spot.pinned,
      label: anchor.title
    };
    for (
      let step = 0;
      !note.pinned && step < NOTE_STEPS && blockers.some(rect => overlaps(note, rect));
      step += 1
    ) {
      note.y += SNAP;
    }
    blockers.push(note);
    flat.items.push(note);
    if (spot.source !== undefined && spot.point !== undefined) {
      flat.edges.push({
        key: `note:${anchor.path}`,
        from: spot.source.key,
        to: note.key,
        outcome: anchor.from?.outcome ?? "",
        kind: "note",
        points: orthogonalRoute(spot.point, { x: note.x, y: note.y + NOTE_H / 2 })
      });
    }
  }
}

/**
 * The content origin of a flow inside a frame, if that frame shows it.
 *
 * @param flat - The flat result.
 * @param frame - A frame item.
 * @param flow - A flow name.
 * @returns The origin, or undefined.
 * @example
 * ```ts
 * originOf(flat, boardFrame, "board"); // { x: 520, y: 340 }
 * ```
 */
function originOf(flat: Flat, frame: Item, flow: string): { x: number; y: number } | undefined {
  return flat.origins[originKey(frame.key, flow)];
}

/**
 * Grows a frame to contain items (plus the frame padding).
 *
 * @param frame - The frame item.
 * @param items - Items that must fit.
 * @example
 * ```ts
 * grow(rootFrame, flat.items);
 * ```
 */
function grow(frame: Item, items: readonly Item[]): void {
  for (const entry of items) {
    if (entry === frame || entry.kind === "port") continue;
    frame.w = Math.max(frame.w, entry.x + entry.w + FRAME_PAD - frame.x);
    frame.h = Math.max(frame.h, entry.y + entry.h + FRAME_PAD - frame.y);
  }
}

/**
 * Lays out the graph from a root flow: frames, hub lanes or ELK, pins, notes.
 *
 * @param input - Graph, root, expanded set, pins, note anchors, config and the ELK engine.
 * @returns The layout result in world coordinates.
 * @example
 * ```ts
 * const result = await composeLayout({ graph, root: "main", expanded: new Set(["main/board"]), pins, notes: [], config, engine });
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
  placeNotes(input, flat, root);
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
