/**
 * @file flowView layout module — the hub-lane layout of design §7.1–7.5: the prefix row, the hub
 * with one port per outcome in declared order, one lane per outcome (action node, its rows,
 * second-level nodes in the next column), return stubs instead of lines back to the hub, exits on
 * the frame's right edge, column heads. The gap after the hub fits its widest outcome label; a
 * label pass keeps every edge label clear of its source and of the other labels and items (shift
 * down by 20 until free). Pure and synchronous.
 */
import type { EdgePath, FlowJson, Item, Rect } from "../types";
import { exitOf, targetNode } from "./back-edges";
import { anchorIn, anchorOut, orthogonalRoute } from "./routes";
import type { FlowBox, NodeSizes } from "./types";
import {
  COL_GAP,
  FRAME_PAD,
  HUB_GAP,
  HUB_HEAD,
  HUB_W,
  LABEL_H,
  LANE_PAD,
  labelWidth,
  NODE_H,
  NODE_W,
  PORT,
  ROW,
  STUB_H,
  STUB_W
} from "./types";

/**
 * The working set of one lane layout.
 */
type LaneWork = {
  readonly flowName: string;
  readonly flow: FlowJson;
  readonly hub: string;
  readonly sizes: NodeSizes;
  readonly items: Item[];
  readonly edges: EdgePath[];
  /** Node name → its item. */
  readonly placed: Map<string, Item>;
  /** Exit names in first-use order, with the y of the first use. */
  readonly exits: { readonly name: string; readonly y: number }[];
  /** Edges to exit ports, routed once the ports are placed. */
  readonly exitEdges: { readonly from: Item; readonly outcome: string; readonly exit: string }[];
};

/**
 * Empty space under the lanes before the block of unreached nodes.
 */
export const UNREACHED_GAP = 48;

/**
 * Space under the last lane inside the hub.
 */
const HUB_FOOT = 8;

/**
 * How far the column heads sit above the first lane.
 */
const HEAD_LIFT = 20;

/**
 * Space between an edge label and the item it leaves.
 */
const LABEL_GAP = 4;

/**
 * How far one step of the label pass moves a colliding label down.
 */
const LABEL_SHIFT = 20;

/**
 * Steps of the label pass before a label stays on its edge's row.
 */
const LABEL_STEPS = 8;

/**
 * The gap between the hub and column 1: HUB_GAP, or wider so the widest outcome label fits.
 *
 * @param outcomes - The hub's outcomes.
 * @returns The gap in px.
 * @example
 * ```ts
 * hubGap(["tap", "openSettings"]); // 99.2: "openSettings" is 91.2 px wide
 * ```
 */
export function hubGap(outcomes: readonly string[]): number {
  return Math.max(HUB_GAP, ...outcomes.map(outcome => labelWidth(outcome) + 2 * LABEL_GAP));
}

/**
 * True when two rects overlap (touching edges do not).
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
 * The rect of a label chip centred on a point.
 *
 * @param x - Centre x.
 * @param y - Centre y.
 * @param width - Chip width.
 * @returns The rect.
 * @example
 * ```ts
 * labelRect(100, 50, 38.4); // { x: 80.8, y: 41, w: 38.4, h: 18 }
 * ```
 */
function labelRect(x: number, y: number, width: number): Rect {
  return { x: x - width / 2, y: y - LABEL_H / 2, w: width, h: LABEL_H };
}

/**
 * The label pass: each edge label sits on its first segment, right of its source, and moves down
 * by 20 until it meets no other label and no item; when no step is free it stays on the row.
 *
 * @param work - The lane work (edges get their `labelAt`).
 */
function placeLabels(work: LaneWork): void {
  const byKey = new Map(work.items.map(entry => [entry.key, entry]));
  const blockers: Rect[] = work.items.filter(entry => entry.kind !== "port");
  const labels: Rect[] = [];
  const collides = (box: Rect): boolean =>
    [...labels, ...blockers].some(other => overlaps(box, other));

  for (const [index, edge] of work.edges.entries()) {
    const [first, second] = edge.points;
    if (edge.kind !== "edge" || edge.label === undefined) continue;
    if (first === undefined || second === undefined) continue;

    // On the first segment, clear of the source's right side.
    const width = labelWidth(edge.label);
    const from = byKey.get(edge.from);
    const left = from === undefined ? first.x : from.x + from.w + LABEL_GAP;
    const x = Math.max((first.x + second.x) / 2, left + width / 2);

    // Down by 20 until free; nowhere free keeps the row.
    const row = (first.y + second.y) / 2;
    let y = row;
    for (let step = 0; step < LABEL_STEPS && collides(labelRect(x, y, width)); step += 1) {
      y += LABEL_SHIFT;
    }
    if (collides(labelRect(x, y, width))) y = row;

    labels.push(labelRect(x, y, width));
    work.edges[index] = { ...edge, labelAt: { x, y } };
  }
}

/**
 * The size of a node: its expanded box, else a card.
 *
 * @param work - The lane work.
 * @param node - The node name.
 * @returns Width and height.
 * @example
 * ```ts
 * sizeOf(work, "merge"); // { w: 172, h: 44 }
 * ```
 */
function sizeOf(work: LaneWork, node: string): { readonly w: number; readonly h: number } {
  return work.sizes.get(node) ?? { w: NODE_W, h: NODE_H };
}

/**
 * Places a node as an item.
 *
 * @param work - The lane work.
 * @param node - The node name.
 * @param x - Content x.
 * @param y - Content y.
 * @returns The item.
 * @example
 * ```ts
 * place(work, "tapGenerator", 264, 77);
 * ```
 */
function place(work: LaneWork, node: string, x: number, y: number): Item {
  const size = sizeOf(work, node);
  const item: Item = {
    key: `${work.flowName}/${node}`,
    id: `${work.flowName}/${node}`,
    kind: "node",
    x,
    y,
    w: size.w,
    h: size.h,
    flow: work.flowName,
    pinned: false
  };
  work.items.push(item);
  work.placed.set(node, item);
  return item;
}

/**
 * Adds an edge between two items.
 *
 * @param work - The lane work.
 * @param from - Source item.
 * @param outcome - The outcome.
 * @param to - Target item.
 * @example
 * ```ts
 * connect(work, hub, "tap", tapGenerator);
 * ```
 */
function connect(work: LaneWork, from: Item, outcome: string, to: Item): void {
  work.edges.push({
    key: `${from.id}:${outcome}`,
    from: from.key,
    to: to.key,
    outcome,
    kind: "edge",
    points: orthogonalRoute(anchorOut(from, outcome), anchorIn(to)),
    label: outcome
  });
}

/**
 * Adds a stub for an edge whose target is the hub ("↩ hub") or already placed ("→ node"), with
 * the edge into it and the return edge drawn on hover or selection.
 *
 * @param work - The lane work.
 * @param from - Source item.
 * @param outcome - The outcome.
 * @param target - Target node name.
 * @param x - Content x of the stub column.
 * @param rowY - Top of the row.
 * @example
 * ```ts
 * stub(work, merge, "done", "awaitIntent", 586, 373);
 * ```
 */
function stub(
  work: LaneWork,
  from: Item,
  outcome: string,
  target: string,
  x: number,
  rowY: number
): void {
  const targetItem = work.placed.get(target);
  const item: Item = {
    key: `stub:${from.id}:${outcome}`,
    id: `${work.flowName}/${target}`,
    kind: "stub",
    x,
    y: rowY + (ROW - STUB_H) / 2,
    w: STUB_W,
    h: STUB_H,
    flow: work.flowName,
    pinned: false,
    label: target === work.hub ? `↩ ${target}` : `→ ${target}`,
    target: `${work.flowName}/${target}`
  };
  work.items.push(item);
  connect(work, from, outcome, item);
  if (targetItem === undefined) return;
  work.edges.push({
    key: `${from.id}:${outcome}`,
    from: item.key,
    to: targetItem.key,
    outcome,
    kind: "return",
    points: orthogonalRoute(anchorOut(item, outcome), anchorIn(targetItem))
  });
}

/**
 * Records an edge to an exit port (routed when the ports are placed).
 *
 * @param work - The lane work.
 * @param from - Source item.
 * @param outcome - The outcome.
 * @param exit - The exit name.
 * @param y - Content y of the use.
 * @example
 * ```ts
 * toExit(work, hub, "leave", "left", 850);
 * ```
 */
function toExit(work: LaneWork, from: Item, outcome: string, exit: string, y: number): void {
  if (!work.exits.some(entry => entry.name === exit)) work.exits.push({ name: exit, y });
  work.exitEdges.push({ from, outcome, exit });
}

/**
 * The exit, or the in-flow target node, of one outcome.
 *
 * @param flow - The flow.
 * @param node - The source node.
 * @param outcome - The outcome.
 * @returns The exit name and the target node (each undefined when absent).
 * @example
 * ```ts
 * edgeOf(board, "awaitIntent", "leave"); // { exit: "left", target: undefined }
 * ```
 */
function edgeOf(
  flow: FlowJson,
  node: string,
  outcome: string
): { readonly exit: string | undefined; readonly target: string | undefined } {
  const raw = flow.edges[node]?.[outcome] ?? "";
  const target = targetNode(raw) ?? "";
  return { exit: exitOf(raw), target: flow.nodes[target] === undefined ? undefined : target };
}

/**
 * Places one row of a node: an edge to an exit port, a stub to the hub or a placed node, or the
 * target placed at (x, y) with its own rows.
 *
 * @param work - The lane work.
 * @param node - The source node.
 * @param from - Its item.
 * @param outcome - The outcome of the row.
 * @param x - Content x of the next column.
 * @param y - Content y of the row.
 * @returns The height the row uses.
 * @example
 * ```ts
 * placeRow(work, "tapGenerator", tapItem, "noEnergy", 586, 123); // 92
 * ```
 */
function placeRow(
  work: LaneWork,
  node: string,
  from: Item,
  outcome: string,
  x: number,
  y: number
): number {
  const { exit, target } = edgeOf(work.flow, node, outcome);
  if (exit !== undefined) {
    toExit(work, from, outcome, exit, from.ports?.[outcome] ?? y + ROW / 2);
    return ROW;
  }
  if (target === undefined) return ROW;
  if (target === work.hub || work.placed.has(target)) {
    stub(work, from, outcome, target, x, y);
    return ROW;
  }
  const next = place(work, target, x, y);
  connect(work, from, outcome, next);
  return Math.max(ROW, next.h, placeRows(work, target, next));
}

/**
 * Lays out the rows of a placed node (one per outcome, declared order) and, recursively, the
 * unplaced targets in the next column of the same rows.
 *
 * @param work - The lane work.
 * @param node - The node name.
 * @param item - Its item.
 * @returns The height the node and its rows use.
 * @example
 * ```ts
 * placeRows(work, "tapGenerator", tapItem); // 230
 * ```
 */
function placeRows(work: LaneWork, node: string, item: Item): number {
  const nextX = item.x + item.w + COL_GAP;
  let rowY = item.y;
  for (const outcome of work.flow.nodes[node]?.outcomes ?? []) {
    rowY += placeRow(work, node, item, outcome, nextX, rowY);
  }
  return Math.max(rowY - item.y, item.h);
}

/**
 * The first path (declared order) from the start to the hub, without the hub.
 *
 * @param flow - The flow.
 * @param hub - The hub node.
 * @returns The prefix nodes, empty when the start is the hub or the hub is unreachable.
 * @example
 * ```ts
 * prefixPath(board, "awaitIntent"); // []
 * ```
 */
function prefixPath(flow: FlowJson, hub: string): string[] {
  const seen = new Set<string>();
  /**
   * The path from a node to the hub, depth first in declared order.
   *
   * @param node - The node name.
   * @returns The nodes before the hub, or undefined when the hub is not reached.
   * @example
   * ```ts
   * search("boot"); // ["boot", "splash"]
   * ```
   */
  function search(node: string): string[] | undefined {
    if (node === hub) return [];
    if (seen.has(node) || flow.nodes[node] === undefined) return undefined;
    seen.add(node);
    for (const outcome of flow.nodes[node]?.outcomes ?? []) {
      const { target } = edgeOf(flow, node, outcome);
      const rest = target === undefined ? undefined : search(target);
      if (rest !== undefined) return [node, ...rest];
    }
    return undefined;
  }
  return search(flow.start) ?? [];
}

/**
 * Connects one outcome of a prefix node: an exit port, an edge to a node further right, a stub to
 * a node to its left.
 *
 * @param work - The lane work.
 * @param node - The prefix node.
 * @param item - Its item.
 * @param outcome - The outcome.
 * @example
 * ```ts
 * connectOutcome(work, "splash", splashItem, "loaded");
 * ```
 */
function connectOutcome(work: LaneWork, node: string, item: Item, outcome: string): void {
  const { exit, target } = edgeOf(work.flow, node, outcome);
  const targetItem = target === undefined ? undefined : work.placed.get(target);
  if (exit !== undefined) toExit(work, item, outcome, exit, item.y + item.h / 2);
  else if (targetItem !== undefined && target !== undefined) {
    if (targetItem.x > item.x) connect(work, item, outcome, targetItem);
    else stub(work, item, outcome, target, item.x + item.w + COL_GAP / 4, item.y + item.h);
  }
}

/**
 * Connects the outcomes of the prefix nodes once every lane is placed.
 *
 * @param work - The lane work.
 * @param prefix - The prefix nodes in order.
 * @example
 * ```ts
 * connectPrefix(work, ["boot", "splash"]);
 * ```
 */
function connectPrefix(work: LaneWork, prefix: readonly string[]): void {
  for (const node of prefix) {
    const item = work.placed.get(node);
    if (item === undefined) continue;
    for (const outcome of work.flow.nodes[node]?.outcomes ?? [])
      connectOutcome(work, node, item, outcome);
  }
}

/**
 * Places the exit ports on the frame's right edge (first-use order, kept apart) and the entry
 * port on its left edge, then routes the edges into the exits.
 *
 * @param work - The lane work.
 * @param right - Content width.
 * @param entryY - Content y of the entry.
 */
function placePorts(work: LaneWork, right: number, entryY: number): void {
  const ports = new Map<string, Item>();
  let lastY = Number.NEGATIVE_INFINITY;
  for (const exit of work.exits) {
    const y = Math.max(exit.y - PORT / 2, lastY + 2 * PORT);
    lastY = y;
    const port: Item = {
      key: `exit:${exit.name}`,
      id: `${work.flowName}/exit:${exit.name}`,
      kind: "port",
      x: right + FRAME_PAD - PORT / 2,
      y,
      w: PORT,
      h: PORT,
      flow: work.flowName,
      pinned: false,
      label: `exit:${exit.name}`
    };
    ports.set(exit.name, port);
    work.items.push(port);
  }
  for (const edge of work.exitEdges) {
    const port = ports.get(edge.exit);
    if (port !== undefined) connect(work, edge.from, edge.outcome, port);
  }
  work.items.push({
    key: "entry",
    id: `${work.flowName}/entry`,
    kind: "port",
    x: -FRAME_PAD - PORT / 2,
    y: entryY - PORT / 2,
    w: PORT,
    h: PORT,
    flow: work.flowName,
    pinned: false,
    label: "entry"
  });
}

/**
 * Lays out a flow around its hub (design §7.1–7.5). Coordinates are relative to the flow's content
 * origin; nodes the walk does not reach are listed in `unreached`.
 *
 * @param flowName - The flow name.
 * @param flow - The flow.
 * @param hub - The hub node.
 * @param sizes - Sizes of expanded sub-flow boxes by node name.
 * @returns The flow box.
 * @example
 * ```ts
 * layoutLanes("board", board, "awaitIntent").lanes.length; // 8
 * ```
 */
export function layoutLanes(
  flowName: string,
  flow: FlowJson,
  hub: string,
  sizes: NodeSizes = new Map()
): FlowBox {
  const work: LaneWork = {
    flowName,
    flow,
    hub,
    sizes,
    items: [],
    edges: [],
    placed: new Map(),
    exits: [],
    exitEdges: []
  };

  // The prefix row from the start to the hub, then the hub with one port per outcome.
  const prefix = prefixPath(flow, hub);
  let x = 0;
  for (const node of prefix) x += place(work, node, x, 0).w + COL_GAP;

  const hubItem: Item = { ...place(work, hub, x, 0), kind: "hub", w: HUB_W, ports: {} };
  work.items[work.items.length - 1] = hubItem;
  work.placed.set(hub, hubItem);
  const ports: Record<string, number> = {};
  hubItem.ports = ports;

  // One lane per outcome, in declared order: its rows decide its height.
  const columnOne = x + HUB_W + hubGap(flow.nodes[hub]?.outcomes ?? []);
  const lanes: { index: number; outcome: string; y: number; h: number }[] = [];
  let laneTop = HUB_HEAD;

  for (const [index, outcome] of (flow.nodes[hub]?.outcomes ?? []).entries()) {
    const portY = laneTop + LANE_PAD + ROW / 2;
    ports[outcome] = portY;
    const used = placeRow(work, hub, hubItem, outcome, columnOne, laneTop + LANE_PAD);
    const height = used + 2 * LANE_PAD;
    lanes.push({ index, outcome, y: laneTop, h: height });
    laneTop += height;
  }
  hubItem.h = laneTop + HUB_FOOT;

  // Once every node is placed: the prefix edges, the bounds, the exit and entry ports.
  connectPrefix(work, prefix);

  const right = Math.max(...work.items.map(entry => entry.x + entry.w));
  const bottom = Math.max(...work.items.map(entry => entry.y + entry.h));
  const bandX = x + HUB_W;
  const entryY = prefix.length > 0 ? NODE_H / 2 : HUB_HEAD / 2;
  placePorts(work, right, entryY);
  placeLabels(work);

  return {
    items: work.items,
    edges: work.edges,
    lanes: lanes.map(lane => ({ ...lane, x: bandX, w: right - bandX, trail: false })),
    heads: [
      { label: "Action node", x: columnOne, y: HUB_HEAD - HEAD_LIFT },
      { label: "Its outcomes → next", x: columnOne + NODE_W + COL_GAP, y: HUB_HEAD - HEAD_LIFT }
    ],
    bounds: { x: 0, y: 0, w: right, h: bottom },
    unreached: Object.keys(flow.nodes).filter(node => !work.placed.has(node))
  };
}
