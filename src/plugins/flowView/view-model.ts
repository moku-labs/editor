/**
 * @file flowView plugin — the view data of the Flow workspace, computed from the state with the
 * focus module's graph and trail queries and passed to the components by props (spec/15 §2.5: the
 * render and inspector modules never import the focus module).
 */
import { incoming, nodeKinds, outgoing, parentsOf, resolveStack } from "./focus/graph";
import { entryFrame, entryKey, frameLabel, rejectedEdges, trailRanks } from "./focus/trail";
import { fileOfNode } from "./inspector/files";
import type { InfoView } from "./inspector/types";
import { edgeId, laneId } from "./render/Edges";
import type {
  CardView,
  EdgeView,
  FrameView,
  Glyph,
  HistoryRow,
  HubView,
  NoteView,
  StubView,
  WorldView
} from "./render/types";
import type {
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
 * The parts of the state every view computation reads.
 */
type ViewInputs = {
  readonly graph: GraphJson;
  readonly result: LayoutResult;
  readonly selected: ItemKey | undefined;
  readonly related: ReadonlySet<ItemKey> | undefined;
  readonly current: ItemKey | undefined;
  readonly stack: ReadonlySet<NodeId>;
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
    dimmed: inputs.related !== undefined && !inputs.related.has(item.key),
    trail: trailItems.has(item.key),
    onStack: inputs.stack.has(item.id),
    expandable: node?.subFlow !== undefined || node?.slot !== undefined,
    expanded
  };
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
  const payload = entry.payload;
  const reason =
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    typeof payload.reason === "string"
      ? ` · ${payload.reason}`
      : "";
  return `✕ ${entry.outcome} · ${at}${reason}`;
}

/**
 * The head of a frame: "# board · sub-flow of main/board · 10 nodes · on the stack".
 *
 * @param inputs - The view inputs.
 * @param frame - The frame item.
 * @returns The head text and whether it is on the stack.
 * @example
 * ```ts
 * frameHead(inputs, boardFrame).head;
 * ```
 */
function frameHead(
  inputs: ViewInputs,
  frame: Item
): { readonly head: string; readonly onStack: boolean } {
  const { graph, result } = inputs;
  if (frame.key.startsWith("#")) {
    const parent = parentsOf(graph, frame.id)[0];
    const count = Object.keys(graph.flows[frame.id]?.nodes ?? {}).length;
    const onStack = [...inputs.stack].some(id => id.startsWith(`${frame.id}/`));
    if (frame.id === graph.main || parent === undefined) return { head: `# ${frame.id}`, onStack };
    return {
      head: `# ${frame.id} · sub-flow of ${parent} · ${count} nodes${onStack ? " · on the stack" : ""}`,
      onStack
    };
  }
  const slash = frame.id.indexOf("/");
  const node = graph.flows[frame.id.slice(0, slash)]?.nodes[frame.id.slice(slash + 1)];
  const inner = result.items.filter(
    entry =>
      entry.parent === frame.key &&
      (entry.kind === "node" || entry.kind === "hub" || entry.kind === "frame")
  );
  const onStack = inputs.stack.has(frame.id);
  const what =
    node?.subFlow === undefined
      ? `${node?.slot ?? ""} · slot of ${frame.id}`
      : `${node.subFlow} · sub-flow of ${frame.id}`;
  return { head: `# ${what} · ${inner.length} nodes${onStack ? " · on the stack" : ""}`, onStack };
}

/**
 * The view inputs of the current state, or undefined without a graph or a layout.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @returns The inputs.
 * @example
 * ```ts
 * const inputs = inputsOf(ctx, actions);
 * ```
 */
function inputsOf(ctx: FlowCtx, actions: FlowActions): ViewInputs | undefined {
  const { graph, history } = ctx.state.data;
  const result = ctx.state.layout.result;
  if (graph === undefined || result === undefined) return undefined;
  return {
    graph,
    result,
    selected: ctx.state.focus.selected,
    related: actions.focus.related(),
    current: actions.focus.locateCurrent()?.item.key,
    stack: new Set(actions.focus.stack().map(entry => entry.id)),
    trail: trailRanks(history, graph, ctx.config.trailLength),
    rejected: rejectedEdges(history, graph, ctx.config.rejectedOutcomes)
  };
}

/**
 * The edge views and the items a trail edge touches.
 *
 * @param ctx - Domain context of flowView.
 * @param inputs - The view inputs.
 * @returns Edge views by edge id and the trail items.
 * @example
 * ```ts
 * edgeViews(ctx, inputs).trailItems.has("main/home");
 * ```
 */
function edgeViews(
  ctx: FlowCtx,
  inputs: ViewInputs
): { readonly edges: Map<string, EdgeView>; readonly trailItems: Set<ItemKey> } {
  const trailItems = new Set<ItemKey>();
  const edges = new Map<string, EdgeView>();
  for (const edge of inputs.result.edges) {
    const rank = edge.kind === "edge" ? inputs.trail.get(edge.key) : undefined;
    if (rank !== undefined) {
      trailItems.add(edge.from);
      if (edge.to !== undefined) trailItems.add(edge.to);
    }
    const related =
      inputs.selected !== undefined &&
      (edge.from === inputs.selected || edge.to === inputs.selected);
    edges.set(edgeId(edge), {
      rank,
      rejected: edge.kind === "edge" && inputs.rejected.has(edge.key),
      related,
      dimmed: inputs.related !== undefined && !related,
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
 * @example
 * ```ts
 * hubOf(ctx, inputs, hub, trailItems).outcomes.length; // 8
 * ```
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
 * @example
 * ```ts
 * stubOf(ctx, inputs, stub).rejected; // "✕ rejected · frame 1778 · empty"
 * ```
 */
function stubOf(ctx: FlowCtx, inputs: ViewInputs, item: Item): StubView {
  const into = inputs.result.edges.find(edge => edge.kind === "edge" && edge.to === item.key);
  const entry = into === undefined ? undefined : inputs.rejected.get(into.key);
  return {
    trail: into !== undefined && inputs.trail.has(into.key),
    rejected: entry === undefined ? undefined : rejectedText(entry, ctx.state.focus.frames),
    selected: inputs.selected === item.key,
    dimmed: inputs.related !== undefined && !inputs.related.has(item.key)
  };
}

/**
 * The view of a note node.
 *
 * @param ctx - Domain context of flowView.
 * @param item - The note item.
 * @returns The note view.
 * @example
 * ```ts
 * noteOf(ctx, note).lines.length; // up to 3
 * ```
 */
function noteOf(ctx: FlowCtx, item: Item): NoteView {
  const note = ctx.state.notes.files.find(file => file.path === item.id)?.note;
  return {
    title: note?.title ?? item.label ?? item.id,
    lines: (note?.body ?? "")
      .split("\n")
      .filter(line => line.trim() !== "")
      .slice(0, 3),
    captures: note?.captures.length ?? 0,
    status: note?.status ?? "idea"
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
 * @example
 * ```ts
 * const world = worldView(ctx, actions);
 * ```
 */
export function worldView(ctx: FlowCtx, actions: FlowActions): WorldView | undefined {
  const inputs = inputsOf(ctx, actions);
  if (inputs === undefined) return undefined;
  const { edges, trailItems } = edgeViews(ctx, inputs);
  const cards = new Map<ItemKey, CardView>();
  const hubs = new Map<ItemKey, HubView>();
  const frames = new Map<ItemKey, FrameView>();
  const stubs = new Map<ItemKey, StubView>();
  const notes = new Map<ItemKey, NoteView>();
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
      case "note": {
        notes.set(item.key, noteOf(ctx, item));
        break;
      }
      case "frame": {
        const { head, onStack } = frameHead(inputs, item);
        frames.set(item.key, { head, onStack, root: item.key.startsWith("#"), dimmed: false });
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
    notes,
    edges,
    trailLanes: trailLanesOf(inputs.result, inputs.trail),
    stale: ctx.state.data.stale
  };
}

/**
 * The history rows, newest first.
 *
 * @param ctx - Domain context of flowView.
 * @returns The rows.
 * @example
 * ```ts
 * historyView(ctx)[0]?.label; // "f1778" or "#12"
 * ```
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
 * @example
 * ```ts
 * lastVisit(ctx, graph, "board/merge", false); // "f1778"
 * ```
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
 * What the Info tab shows for a node.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The flowView actions.
 * @param id - The node id.
 * @returns The info, or undefined for an unknown node.
 * @example
 * ```ts
 * infoView(ctx, actions, "board/merge")?.outcomes.map(row => row.outcome); // ["done", "rejected"]
 * ```
 */
export function infoView(ctx: FlowCtx, actions: FlowActions, id: NodeId): InfoView | undefined {
  const { graph, history, position } = ctx.state.data;
  const slash = id.indexOf("/");
  const flow = id.slice(0, slash);
  const name = id.slice(slash + 1);
  const node = graph?.flows[flow]?.nodes[name];
  if (graph === undefined || node === undefined) return undefined;

  const current = actions.focus.current() === id;
  const result = ctx.state.layout.result;
  const frames = result?.frames.filter(frame => parentsOf(graph, flow).includes(frame.id)) ?? [];
  const parent = frames.length === 1 ? frames[0]?.id : undefined;
  const fires = new Map<string, HistoryEntryJson>();
  for (const entry of history) {
    const key = entryKey(entry, graph);
    if (key !== undefined) fires.set(key, entry);
  }
  const rejected = rejectedEdges(history, graph, ctx.config.rejectedOutcomes);
  const key = result?.items.find(
    item => item.id === id && item.kind !== "stub" && item.kind !== "note"
  )?.key;
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
    outcomes: outgoing(graph, id, parent).map(row => {
      const target = targetText(row.to, row.exit);
      const fire = fires.get(row.key);
      const rejection = rejected.get(row.key);
      return {
        outcome: row.outcome,
        target,
        targetId: row.to,
        back: row.back,
        waiting: current && (position?.waiting ?? []).includes(row.outcome),
        frame: fire === undefined ? undefined : frameLabel(fire, ctx.state.focus.frames),
        rejected:
          rejection === undefined ? undefined : `✕ ${frameLabel(rejection, ctx.state.focus.frames)}`
      };
    }),
    comesFrom: incoming(graph, id).map(row => ({
      from: row.from,
      outcome: row.outcome,
      via: row.via
    })),
    file: lookup === undefined ? undefined : fileOfNode(lookup, graph, id)
  };
}
