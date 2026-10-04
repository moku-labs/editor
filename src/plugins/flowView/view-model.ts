/**
 * @file flowView plugin — the view data of the Flow workspace, computed from the state with the
 * focus module's graph and trail queries and passed to the components by props (spec/15 §2.5: the
 * render and inspector modules never import the focus module).
 */
import type { Json } from "../registry/protocol";
import { incomingEdge, localKey, outgoingEdgeKey } from "./focus/edges";
import { incoming, nodeKinds, outgoing, parentsOf, resolveStack } from "./focus/graph";
import { entryFrame, frameLabel, lastFires, rejectedEdges, trailRanks } from "./focus/trail";
import { fileOfNode } from "./inspector/files";
import type { InfoOutcome, InfoSource, InfoView } from "./inspector/types";
import { edgeId, laneId } from "./render/Edges";
import type {
  CardView,
  EdgeView,
  FrameView,
  Glyph,
  HistoryRow,
  HubView,
  StubView,
  WorldView
} from "./render/types";
import type {
  EdgePath,
  FlowActions,
  FlowCtx,
  GraphJson,
  HistoryEntryJson,
  Item,
  ItemKey,
  LayoutResult,
  NodeId
} from "./types";

/**
 * Trail edges drawn 2 px: the last three transitions.
 */
const RECENT_TRAIL = 3;

/**
 * The parts of the state every view computation reads.
 */
type ViewInputs = {
  readonly graph: GraphJson;
  readonly result: LayoutResult;
  readonly selected: ItemKey | undefined;
  readonly related: ReadonlySet<ItemKey> | undefined;
  readonly current: ItemKey | undefined;
  readonly pulse: ItemKey | undefined;
  readonly stack: ReadonlySet<NodeId>;
  /** Items holding the current node (`holdsCurrent`). */
  readonly holders: ReadonlySet<ItemKey>;
  readonly trail: ReadonlyMap<string, number>;
  readonly rejected: ReadonlyMap<string, HistoryEntryJson>;
};

/**
 * The glyph of a node from its kinds.
 *
 * @param kinds - The node kinds.
 * @returns The glyph.
 * @example
 * ```ts
 * glyphOf(["start", "rest"]); // "rest"
 * ```
 */
export function glyphOf(kinds: readonly string[]): Glyph {
  for (const glyph of ["sub-flow", "slot", "rest", "start"] as const) {
    if (kinds.includes(glyph)) return glyph;
  }
  return "transit";
}

/**
 * The second line of a card: "sub-flow · settingsPopup", "slot · reward → rewardPopup (order 10)",
 * "rest · scene board".
 *
 * @param graph - The graph.
 * @param id - The node id.
 * @param kinds - Its kinds.
 * @returns The kind line.
 * @example
 * ```ts
 * kindLine(graph, "main/afterOrder", ["slot"]); // "slot · reward → rewardPopup (order 10)"
 * ```
 */
export function kindLine(graph: GraphJson, id: NodeId, kinds: readonly string[]): string {
  const slash = id.indexOf("/");
  const node = graph.flows[id.slice(0, slash)]?.nodes[id.slice(slash + 1)];
  if (node?.subFlow !== undefined) return `sub-flow · ${node.subFlow}`;
  if (node?.slot !== undefined) {
    const parts = (graph.slots[node.slot] ?? []).map(
      entry => `${entry.feature} → ${entry.flow} (order ${entry.order})`
    );
    return `slot · ${parts.join(" · ")}`;
  }
  if (node?.rest === true) return node.scene === undefined ? "rest" : `rest · scene ${node.scene}`;
  return kinds.join(" · ");
}

/**
 * True for an item the selection dims: something is selected, the item is not related to it and
 * it does not hold the current node (the current node and what holds it never fade).
 *
 * @param inputs - The view inputs.
 * @param key - The item key.
 * @returns Whether the item is dimmed.
 */
function isDimmed(inputs: ViewInputs, key: ItemKey): boolean {
  return inputs.related !== undefined && !inputs.related.has(key) && !inputs.holders.has(key);
}

/**
 * The view of one card.
 *
 * @param inputs - The view inputs.
 * @param item - A node or hub item.
 * @param expanded - Whether its key is expanded.
 * @param trailItems - Items touched by a trail edge.
 * @returns The card view.
 * @example
 * ```ts
 * cardOf(inputs, item, false, trailItems).glyph; // "rest"
 * ```
 */
function cardOf(
  inputs: ViewInputs,
  item: Item,
  expanded: boolean,
  trailItems: ReadonlySet<ItemKey>
): CardView {
  const kinds = nodeKinds(inputs.graph, item.id);
  const slash = item.id.indexOf("/");
  const node = inputs.graph.flows[item.id.slice(0, slash)]?.nodes[item.id.slice(slash + 1)];
  return {
    name: item.id.slice(slash + 1),
    glyph: glyphOf(kinds),
    kinds,
    kindLine: kindLine(inputs.graph, item.id, kinds),
    selected: item.key === inputs.selected,
    current: item.key === inputs.current,
    holdsCurrent: inputs.holders.has(item.key),
    dimmed: isDimmed(inputs, item.key),
    pulse: item.key === inputs.pulse,
    trail: trailItems.has(item.key),
    onStack: inputs.stack.has(item.id),
    expandable: node?.subFlow !== undefined || node?.slot !== undefined,
    expanded
  };
}

/**
 * The `reason` text of a history payload: an object payload with a string `reason`.
 *
 * @param payload - The entry payload.
 * @returns The reason, or undefined.
 * @example
 * ```ts
 * reasonOf({ reason: "empty" }); // "empty"
 * reasonOf(["empty"]); // undefined
 * ```
 */
function reasonOf(payload: Json): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  return typeof payload.reason === "string" ? payload.reason : undefined;
}

/**
 * The text of a rejected stub: "✕ rejected · frame 1778 · empty".
 *
 * @param entry - The rejected history entry.
 * @param frames - Frames seen live.
 * @returns The text.
 * @example
 * ```ts
 * rejectedText(entry, new Map()); // "✕ rejected · frame 1778 · empty"
 * ```
 */
function rejectedText(entry: HistoryEntryJson, frames: ReadonlyMap<number, number>): string {
  const frame = entryFrame(entry, frames);
  const at = frame === undefined ? `#${entry.index}` : `frame ${frame}`;
  const reason = reasonOf(entry.payload);
  const because = reason === undefined ? "" : ` · ${reason}`;
  return `✕ ${entry.outcome} · ${at}${because}`;
}

/**
 * True for an item that stands for a graph node: a card, a hub or an expanded frame.
 *
 * @param item - A laid-out item.
 * @returns Whether it is a node.
 * @example
 * ```ts
 * isNodeItem({ kind: "stub", … }); // false
 * ```
 */
function isNodeItem(item: Item): boolean {
  return item.kind === "node" || item.kind === "hub" || item.kind === "frame";
}

/**
 * True for an item holding the current node: the current node itself, a collapsed sub-flow, slot
 * or hub, or an expanded frame with the current node inside (its key prefixes the current key), or
 * a node on the position stack.
 *
 * @param item - A laid-out item.
 * @param current - The current item key.
 * @param stack - The node ids of the position stack.
 * @returns Whether it holds the current node.
 * @example
 * ```ts
 * holdsCurrent(boardCard, "main/board>board/awaitIntent", new Set()); // true
 * holdsCurrent(homeCard, "main/board>board/awaitIntent", new Set()); // false
 * ```
 */
function holdsCurrent(
  item: Item,
  current: ItemKey | undefined,
  stack: ReadonlySet<NodeId>
): boolean {
  if (!isNodeItem(item)) return false;
  if (item.key === current || current?.startsWith(`${item.key}>`) === true) return true;
  return stack.has(item.id);
}

/**
 * The suffix of a frame head whose flow is on the runtime stack.
 *
 * @param onStack - Whether the frame's flow is on the stack.
 * @returns " · on the stack", or "".
 * @example
 * ```ts
 * stackSuffix(true); // " · on the stack"
 * ```
 */
function stackSuffix(onStack: boolean): string {
  return onStack ? " · on the stack" : "";
}

/**
 * The head of a root frame: "# main", or "# board · sub-flow of main/board · 10 nodes · on the
 * stack" for an entered flow.
 *
 * @param inputs - The view inputs.
 * @param frame - The root frame item ("#<flow>").
 * @returns The head text and whether its flow is on the stack.
 */
function rootFrameHead(
  inputs: ViewInputs,
  frame: Item
): { readonly head: string; readonly onStack: boolean } {
  const { graph } = inputs;
  const parent = parentsOf(graph, frame.id)[0];
  const onStack = [...inputs.stack].some(id => id.startsWith(`${frame.id}/`));
  if (frame.id === graph.main || parent === undefined) return { head: `# ${frame.id}`, onStack };
  const count = Object.keys(graph.flows[frame.id]?.nodes ?? {}).length;
  return {
    head: `# ${frame.id} · sub-flow of ${parent} · ${count} nodes${stackSuffix(onStack)}`,
    onStack
  };
}

/**
 * The head of an expanded node's frame: "# <sub-flow> · sub-flow of <node id> · <N> nodes", or
 * "# <slot> · slot of <node id> · <N> nodes"; " · on the stack" ends it while the node is on the
 * stack.
 *
 * @param inputs - The view inputs.
 * @param frame - The frame item of an expanded node.
 * @returns The head text and whether the node is on the stack.
 */
function nodeFrameHead(
  inputs: ViewInputs,
  frame: Item
): { readonly head: string; readonly onStack: boolean } {
  const { graph, result } = inputs;
  const slash = frame.id.indexOf("/");
  const node = graph.flows[frame.id.slice(0, slash)]?.nodes[frame.id.slice(slash + 1)];
  const inner = result.items.filter(entry => entry.parent === frame.key && isNodeItem(entry));
  const onStack = inputs.stack.has(frame.id);
  const what =
    node?.subFlow === undefined
      ? `${node?.slot ?? ""} · slot of ${frame.id}`
      : `${node.subFlow} · sub-flow of ${frame.id}`;
  return { head: `# ${what} · ${inner.length} nodes${stackSuffix(onStack)}`, onStack };
}

/**
 * The head of a frame: "# board · sub-flow of main/board · 10 nodes · on the stack".
 *
 * @param inputs - The view inputs.
 * @param frame - The frame item.
 * @returns The head text and whether it is on the stack.
 */
function frameHead(
  inputs: ViewInputs,
  frame: Item
): { readonly head: string; readonly onStack: boolean } {
  return frame.key.startsWith("#") ? rootFrameHead(inputs, frame) : nodeFrameHead(inputs, frame);
}

/**
 * The view inputs of the current state, or undefined without a graph or a layout.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @returns The inputs.
 */
function inputsOf(ctx: FlowCtx, actions: FlowActions): ViewInputs | undefined {
  const { graph, history } = ctx.state.data;
  const result = ctx.state.layout.result;
  if (graph === undefined || result === undefined) return undefined;
  // A collapsed parent the current node sits inside is not current; the stack rule makes it hold it.
  const spot = actions.focus.locateCurrent();
  const current = spot?.inside === undefined ? spot?.item.key : undefined;
  const stack = new Set(actions.focus.stack().map(entry => entry.id));
  const holders = result.items.filter(item => holdsCurrent(item, current, stack));
  return {
    graph,
    result,
    selected: ctx.state.focus.selected,
    related: actions.focus.related(),
    current,
    pulse: ctx.state.focus.pulse,
    stack,
    holders: new Set(holders.map(item => item.key)),
    trail: trailRanks(history, graph, ctx.config.trailLength),
    rejected: rejectedEdges(history, graph, ctx.config.rejectedOutcomes)
  };
}

/**
 * The edge views and the items a trail edge touches. Trail and rejections are graph facts (keyed
 * by the local edge key); the selected edge is one instance. Edges into or out of the current
 * node never dim; a trail edge into an item holding the current node is highlighted and never
 * dims either.
 *
 * @param ctx - Domain context of flowView.
 * @param inputs - The view inputs.
 * @returns Edge views by edge id and the trail items.
 */
function edgeViews(
  ctx: FlowCtx,
  inputs: ViewInputs
): { readonly edges: Map<string, EdgeView>; readonly trailItems: Set<ItemKey> } {
  const trailItems = new Set<ItemKey>();
  const edges = new Map<string, EdgeView>();
  for (const edge of inputs.result.edges) {
    const graphKey = localKey(edge.key);
    const rank = edge.kind === "edge" ? inputs.trail.get(graphKey) : undefined;
    if (rank !== undefined) {
      trailItems.add(edge.from);
      if (edge.to !== undefined) trailItems.add(edge.to);
    }
    const touches = (key: ItemKey | undefined): boolean =>
      key !== undefined && (edge.from === key || edge.to === key);
    const related = touches(inputs.selected);
    const here = rank !== undefined && edge.to !== undefined && inputs.holders.has(edge.to);
    edges.set(edgeId(edge), {
      rank,
      recent: rank !== undefined && rank < RECENT_TRAIL,
      rejected: edge.kind === "edge" && inputs.rejected.has(graphKey),
      related,
      here,
      dimmed: inputs.related !== undefined && !related && !here && !touches(inputs.current),
      selected: edge.kind === "edge" && ctx.state.focus.edge === edge.key
    });
  }
  return { edges, trailItems };
}

/**
 * The view of a hub.
 *
 * @param ctx - Domain context of flowView.
 * @param inputs - The view inputs.
 * @param item - The hub item.
 * @param trailItems - Items touched by a trail edge.
 * @returns The hub view.
 */
function hubOf(
  ctx: FlowCtx,
  inputs: ViewInputs,
  item: Item,
  trailItems: ReadonlySet<ItemKey>
): HubView {
  const card = cardOf(inputs, item, false, trailItems);
  const slash = item.id.indexOf("/");
  const node = inputs.graph.flows[item.id.slice(0, slash)]?.nodes[item.id.slice(slash + 1)];
  const waiting = ctx.state.data.position?.waiting ?? [];
  return {
    ...card,
    outcomes: node?.outcomes ?? [],
    waiting: card.current ? waiting : [],
    scene: node?.scene
  };
}

/**
 * The view of a stub: on the trail, rejected, selected, dimmed.
 *
 * @param ctx - Domain context of flowView.
 * @param inputs - The view inputs.
 * @param item - The stub item.
 * @returns The stub view.
 */
function stubOf(ctx: FlowCtx, inputs: ViewInputs, item: Item): StubView {
  const into = inputs.result.edges.find(edge => edge.kind === "edge" && edge.to === item.key);
  const graphKey = into === undefined ? undefined : localKey(into.key);
  const entry = graphKey === undefined ? undefined : inputs.rejected.get(graphKey);
  return {
    trail: graphKey !== undefined && inputs.trail.has(graphKey),
    rejected: entry === undefined ? undefined : rejectedText(entry, ctx.state.focus.frames),
    selected: inputs.selected === item.key,
    dimmed: isDimmed(inputs, item.key)
  };
}

/**
 * Lane bands whose outcome is on the trail.
 *
 * @param result - The layout.
 * @param trail - Edge key → trail rank.
 * @returns Lane ids.
 * @example
 * ```ts
 * trailLanesOf(result, trail).size; // 2
 * ```
 */
function trailLanesOf(result: LayoutResult, trail: ReadonlyMap<string, number>): Set<string> {
  const lanes = new Set<string>();
  for (const lane of result.lanes) {
    const hub = result.items.find(entry => entry.kind === "hub" && entry.x + entry.w === lane.x);
    if (hub !== undefined && trail.has(`${hub.id}:${lane.outcome}`)) lanes.add(laneId(lane));
  }
  return lanes;
}

/**
 * Everything the world layer draws for the current state.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @returns The world view, or undefined before the first layout.
 */
export function worldView(ctx: FlowCtx, actions: FlowActions): WorldView | undefined {
  const inputs = inputsOf(ctx, actions);
  if (inputs === undefined) return undefined;
  const { edges, trailItems } = edgeViews(ctx, inputs);
  const cards = new Map<ItemKey, CardView>();
  const hubs = new Map<ItemKey, HubView>();
  const frames = new Map<ItemKey, FrameView>();
  const stubs = new Map<ItemKey, StubView>();
  for (const item of inputs.result.items) {
    switch (item.kind) {
      case "node": {
        cards.set(item.key, cardOf(inputs, item, false, trailItems));
        break;
      }
      case "hub": {
        hubs.set(item.key, hubOf(ctx, inputs, item, trailItems));
        break;
      }
      case "stub": {
        stubs.set(item.key, stubOf(ctx, inputs, item));
        break;
      }
      case "frame": {
        const { head, onStack } = frameHead(inputs, item);
        frames.set(item.key, {
          head,
          onStack,
          root: item.key.startsWith("#"),
          dimmed: false,
          holdsCurrent: inputs.holders.has(item.key)
        });
        break;
      }
      case "port": {
        break;
      }
    }
  }
  return {
    result: inputs.result,
    cards,
    hubs,
    frames,
    stubs,
    edges,
    trailLanes: trailLanesOf(inputs.result, inputs.trail),
    stale: ctx.state.data.stale
  };
}

/**
 * The trail edges of a world (the minimap draws them), newest first.
 *
 * @param world - The world view.
 * @returns The drawn edges that are on the trail.
 * @example
 * ```ts
 * trailEdges(world).map(edge => edge.key); // ["main/board>board/merge:done", "main/board>board/awaitIntent:merge"]
 * ```
 */
export function trailEdges(world: WorldView | undefined): readonly EdgePath[] {
  if (world === undefined) return [];
  const rank = (edge: EdgePath): number | undefined => world.edges.get(edgeId(edge))?.rank;
  return world.result.edges
    .filter(edge => rank(edge) !== undefined)
    .toSorted((a, b) => (rank(a) ?? 0) - (rank(b) ?? 0));
}

/**
 * The history rows, newest first.
 *
 * @param ctx - Domain context of flowView.
 * @returns The rows.
 */
export function historyView(ctx: FlowCtx): readonly HistoryRow[] {
  const { history } = ctx.state.data;
  const newest = history.toReversed();
  return newest.map((entry, rank) => ({
    index: entry.index,
    label: frameLabel(entry, ctx.state.focus.frames),
    path: entry.path,
    outcome: entry.outcome,
    next: entry.next,
    payload: JSON.stringify(entry.payload),
    trail: rank < ctx.config.trailLength,
    rejected: ctx.config.rejectedOutcomes.includes(entry.outcome)
  }));
}

/**
 * The last visit of a node: "now · waiting since <label>" for the current node, else the label of
 * the last entry into it, else "not in the last N edges".
 *
 * @param ctx - Domain context of flowView.
 * @param graph - The graph.
 * @param id - The node id.
 * @param current - Whether it is the current node.
 * @returns The text.
 */
function lastVisit(ctx: FlowCtx, graph: GraphJson, id: NodeId, current: boolean): string {
  const { history } = ctx.state.data;
  const into = history.findLast(entry => resolveStack(graph, entry.next).at(-1)?.id === id);
  const label = into === undefined ? undefined : frameLabel(into, ctx.state.focus.frames);
  if (current) return label === undefined ? "now · waiting" : `now · waiting since ${label}`;
  return label ?? `not in the last ${ctx.config.historyLast} edges`;
}

/**
 * The target of an outcome row: the node name, "exit:x → id" for a resolved exit, "exit:x", "—".
 *
 * @param to - The target node id.
 * @param exit - The exit name.
 * @returns The text.
 * @example
 * ```ts
 * targetText("main/afterOrder", "orderComplete"); // "exit:orderComplete → main/afterOrder"
 * ```
 */
function targetText(to: NodeId | undefined, exit: string | undefined): string {
  if (exit === undefined) return to === undefined ? "—" : to.slice(to.indexOf("/") + 1);
  return to === undefined ? `exit:${exit}` : `exit:${exit} → ${to}`;
}

/**
 * The parent sub-flow node of a flow when exactly one frame of it is on screen (it resolves the
 * exit rows of the flow's nodes).
 *
 * @param ctx - Domain context of flowView.
 * @param graph - The graph.
 * @param flow - A flow name.
 * @returns The parent node id, or undefined.
 */
function soleParentFrame(ctx: FlowCtx, graph: GraphJson, flow: string): NodeId | undefined {
  const parents = parentsOf(graph, flow);
  const frames = ctx.state.layout.result?.frames.filter(frame => parents.includes(frame.id)) ?? [];
  return frames.length === 1 ? frames[0]?.id : undefined;
}

/**
 * The outcome rows of the Info tab: target, back edge, waiting, frame of the last fire and of the
 * last rejection, and the instance edge on the canvas.
 *
 * @param ctx - Domain context of flowView.
 * @param graph - The graph.
 * @param id - The node id.
 * @param current - Whether it is the current node (its outcomes can be waiting).
 * @param key - The instance key of the shown node on the canvas.
 * @returns The rows, in declared order.
 */
function outcomeRows(
  ctx: FlowCtx,
  graph: GraphJson,
  id: NodeId,
  current: boolean,
  key: ItemKey | undefined
): InfoOutcome[] {
  const { history, position } = ctx.state.data;
  const { frames } = ctx.state.focus;
  const result = ctx.state.layout.result;
  const fires = lastFires(history, graph);
  const rejected = rejectedEdges(history, graph, ctx.config.rejectedOutcomes);
  const waiting = current ? (position?.waiting ?? []) : [];
  const parent = soleParentFrame(ctx, graph, id.slice(0, id.indexOf("/")));
  return outgoing(graph, id, parent).map(row => {
    const fire = fires.get(row.key);
    const rejection = rejected.get(row.key);
    return {
      outcome: row.outcome,
      edgeKey:
        key === undefined || result === undefined
          ? undefined
          : outgoingEdgeKey(result, key, row.outcome),
      target: targetText(row.to, row.exit),
      targetId: row.to,
      back: row.back,
      waiting: waiting.includes(row.outcome),
      frame: fire === undefined ? undefined : frameLabel(fire, frames),
      rejected: rejection === undefined ? undefined : `✕ ${frameLabel(rejection, frames)}`
    };
  });
}

/**
 * The Comes from rows of the Info tab: source, outcome, "via" parent, frame of the last fire, and
 * the instance edge and source on the canvas.
 *
 * @param ctx - Domain context of flowView.
 * @param graph - The graph.
 * @param id - The node id.
 * @param key - The instance key of the shown node on the canvas.
 * @returns The rows.
 */
function sourceRows(
  ctx: FlowCtx,
  graph: GraphJson,
  id: NodeId,
  key: ItemKey | undefined
): InfoSource[] {
  const fires = lastFires(ctx.state.data.history, graph);
  const result = ctx.state.layout.result;
  return incoming(graph, id).map(row => {
    const fire = fires.get(row.key);
    const drawn =
      key === undefined || result === undefined ? undefined : incomingEdge(result, key, row);
    return {
      from: row.from,
      outcome: row.outcome,
      via: row.via,
      edgeKey: drawn?.edgeKey,
      sourceKey: drawn?.sourceKey,
      frame: fire === undefined ? undefined : frameLabel(fire, ctx.state.focus.frames)
    };
  });
}

/**
 * The instance of a node the Info tab speaks for: the selection when it is that node, else the
 * current node's item when it is, else the node's first instance.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param id - The node id.
 * @returns The instance key, or undefined when the node is not on the canvas.
 */
function shownKey(ctx: FlowCtx, actions: FlowActions, id: NodeId): ItemKey | undefined {
  const result = ctx.state.layout.result;
  const selected = ctx.state.focus.selected;
  const selectedItem = selected === undefined ? undefined : result?.byKey[selected];
  if (selectedItem?.id === id && selectedItem.kind !== "stub") return selectedItem.key;
  const current = actions.focus.locateCurrent()?.item;
  if (current?.id === id) return current.key;
  return result?.items.find(item => item.id === id && isNodeItem(item))?.key;
}

/**
 * What the Info tab shows for a node.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param id - The node id.
 * @returns The info, or undefined for an unknown node.
 */
export function infoView(ctx: FlowCtx, actions: FlowActions, id: NodeId): InfoView | undefined {
  const { graph } = ctx.state.data;
  const slash = id.indexOf("/");
  const flow = id.slice(0, slash);
  const name = id.slice(slash + 1);
  const node = graph?.flows[flow]?.nodes[name];
  if (graph === undefined || node === undefined) return undefined;

  const current = actions.focus.current() === id;
  const key = shownKey(ctx, actions, id);
  const lookup = ctx.state.inspector.sources;

  return {
    id,
    flow,
    node: name,
    kinds: nodeKinds(graph, id),
    scene: node.scene,
    current,
    lastVisit: lastVisit(ctx, graph, id, current),
    slot: (graph.slots[node.slot ?? ""] ?? []).map(
      entry => `${entry.feature} → ${entry.flow}, order ${entry.order}`
    ),
    subFlow: node.subFlow,
    key,
    expanded: key !== undefined && ctx.state.layout.expanded.has(key),
    outcomes: outcomeRows(ctx, graph, id, current, key),
    comesFrom: sourceRows(ctx, graph, id, key),
    file: lookup === undefined ? undefined : fileOfNode(lookup, graph, id)
  };
}
