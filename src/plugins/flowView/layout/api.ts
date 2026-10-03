/**
 * @file flowView layout module — the layout actions (relayout with cache and stale-result drop,
 * the lazy ELK engine, pins load/drop/save/reset with version checks) and the flows namespace
 * (expand, collapse, enter, up).
 */
import { bareMessage, errorCode, isWireError } from "../../registry/protocol";
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment, GraphJson, ItemKey, LayoutResult, NodeId } from "../types";
import { childFlows, composeLayout, instanceKey, originKey } from "./compose";
import { createInlineEngine, createLazyEngine, createWorkerEngine } from "./engine";
import {
  countPins,
  emptyPins,
  flowOfId,
  mergeDirty,
  parsePins,
  resetPins,
  serializePins,
  snap
} from "./pins";
import type { FlowsApi, LayoutActions, LayoutEngine } from "./types";
import { revokeWorkerUrl, workerUrl } from "./worker-source";

/**
 * Layout results kept for repeated inputs.
 */
const CACHE_SIZE = 8;

/**
 * The toast of an invalid layout.json.
 */
const INVALID_PINS = "layout.json is not valid · positions are not saved until it is fixed";

/**
 * True for a version-conflict rejection (-32005).
 *
 * @param error - A rejection.
 * @returns Whether the file changed meanwhile.
 * @example
 * ```ts
 * isConflict(wireError(-32_005, "version conflict")); // true
 * ```
 */
function isConflict(error: unknown): boolean {
  return isWireError(error) && error.code === errorCode.versionConflict;
}

/**
 * True for a missing-file rejection (-32601).
 *
 * @param error - A rejection.
 * @returns Whether the file does not exist.
 * @example
 * ```ts
 * isMissing(wireError(-32_601, "not found")); // true
 * ```
 */
function isMissing(error: unknown): boolean {
  return isWireError(error) && error.code === errorCode.unknownMethod;
}

/**
 * The text of a rejection.
 *
 * @param error - A rejection.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("x")); // "x"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The real ELK engine: a Blob worker when layoutWorker is on and the page allows it, else inline
 * (one warning).
 *
 * @param ctx - Domain context of flowView.
 * @returns The engine.
 * @example
 * ```ts
 * const engine = await realEngine(ctx);
 * ```
 */
async function realEngine(ctx: FlowCtx): Promise<LayoutEngine> {
  if (!ctx.config.layoutWorker) return createInlineEngine();
  let url: string | undefined;
  try {
    url = await workerUrl();
    const source = url;
    return createWorkerEngine(
      () => new Worker(source),
      () => revokeWorkerUrl(source)
    );
  } catch (error) {
    if (url !== undefined) revokeWorkerUrl(url);
    ctx.log.warn("flowView: the layout worker cannot start, ELK runs inline", {
      reason: messageOf(error)
    });
    return createInlineEngine();
  }
}

/**
 * The nodes of a flow that open other flows, with the flows they open.
 *
 * @param graph - The graph.
 * @param flow - A flow name.
 * @returns Node id and opened flows, in declared order.
 * @example
 * ```ts
 * openers(graph, "main"); // [{ id: "main/settings", flows: ["settingsPopup"] }, …]
 * ```
 */
function openers(
  graph: GraphJson,
  flow: string
): { readonly id: NodeId; readonly flows: string[] }[] {
  return Object.entries(graph.flows[flow]?.nodes ?? {})
    .map(([name, node]) => ({ id: `${flow}/${name}`, flows: childFlows(graph, node) }))
    .filter(entry => entry.flows.length > 0);
}

/**
 * The flow chain to a node: the sub-flow and slot nodes to expand from the root down to the frame
 * that shows the node's flow (breadth first, declared order).
 *
 * @param graph - The graph.
 * @param root - The root flow.
 * @param flow - The flow to reach.
 * @returns Node ids from the root down, or undefined when no chain exists.
 * @example
 * ```ts
 * chainTo(graph, "main", "settingsPopup"); // ["main/settings"]
 * ```
 */
function chainTo(graph: GraphJson, root: string, flow: string): NodeId[] | undefined {
  if (root === flow) return [];
  const queue: { readonly flow: string; readonly chain: NodeId[] }[] = [{ flow: root, chain: [] }];
  const seen = new Set<string>([root]);
  for (const current of queue) {
    for (const opener of openers(graph, current.flow)) {
      const chain = [...current.chain, opener.id];
      if (opener.flows.includes(flow)) return chain;
      const fresh = opener.flows.filter(child => !seen.has(child));
      for (const child of fresh) seen.add(child);
      queue.push(...fresh.map(child => ({ flow: child, chain })));
    }
  }
  return undefined;
}

/**
 * Creates the layout actions.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and the late-bound actions.
 * @returns The layout actions.
 * @example
 * ```ts
 * await createLayoutApi(ctx, env).reset();
 * ```
 */
export function createLayoutApi(ctx: FlowCtx, env: FlowEnvironment): LayoutActions {
  const { layout } = ctx.state;
  const path = ctx.config.layoutFile;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The root flow.
   *
   * @returns The flow name.
   * @example
   * ```ts
   * rootFlow(); // "main"
   * ```
   */
  function rootFlow(): string {
    return layout.enter.at(-1)?.flow ?? ctx.state.data.graph?.main ?? "main";
  }

  /**
   * After a new result: the default camera once, the camera onto a selection that just appeared.
   *
   * @param previous - The result before.
   * @param result - The new result.
   * @example
   * ```ts
   * settle(previous, result);
   * ```
   */
  function settle(previous: LayoutResult | undefined, result: LayoutResult): void {
    const camera = env.actions().camera;
    if (env.active() && !ctx.state.camera.initialised) camera.applyDefault();
    const selected = ctx.state.focus.selected;
    const item = selected === undefined ? undefined : result.byKey[selected];
    if (item !== undefined && previous?.byKey[item.key] === undefined) camera.focusItem(item);
  }

  /**
   * Writes the pins with the version; on a conflict re-reads, re-applies the dirty ids and writes
   * once more; a second conflict reloads the file.
   *
   * @param message - The toast of a successful write.
   * @example
   * ```ts
   * await writePins("Layout saved");
   * ```
   */
  async function writePins(message: string): Promise<void> {
    const files = env.files();
    try {
      const written = await files.write(path, serializePins(layout.pins), layout.pinsVersion);
      layout.pinsVersion = written.version;
      layout.dirty.clear();
      env.toast(message, path);
      return;
    } catch (error) {
      if (!isConflict(error)) {
        ctx.log.warn("flowView: layout.json was not written", { path, message: messageOf(error) });
        env.toast(`Layout not saved · ${bareMessage(messageOf(error))}`, path);
        return;
      }
    }

    const fresh = await files.read(path);
    const freshPins = parsePins(fresh.text);
    if (freshPins === undefined) {
      layout.pinsReadOnly = true;
      env.toast(INVALID_PINS);
      return;
    }
    const merged = mergeDirty(freshPins, layout.pins, layout.dirty);
    try {
      const written = await files.write(path, serializePins(merged), fresh.version);
      layout.pins = merged;
      layout.pinsVersion = written.version;
      layout.dirty.clear();
      env.toast(message, path);
      await actions.relayout();
    } catch (error) {
      if (!isConflict(error)) throw error;
      env.toast("layout.json changed on disk · your move was not saved");
      await actions.loadPins();
    }
  }

  /**
   * Runs one save and remembers it in `layout.saving` (onStop waits for it).
   *
   * @param message - The toast of a successful write.
   * @returns The save.
   * @example
   * ```ts
   * await save("Layout saved");
   * ```
   */
  function save(message: string): Promise<void> {
    const running = writePins(message)
      .catch((error: unknown) => {
        ctx.log.warn("flowView: layout.json was not saved", { message: messageOf(error) });
      })
      .finally(() => {
        if (layout.saving === running) layout.saving = undefined;
      });
    layout.saving = running;
    return running;
  }

  /**
   * Debounces the save after a drop (layoutSaveDelayMs).
   *
   * @example
   * ```ts
   * scheduleSave();
   * ```
   */
  function scheduleSave(): void {
    if (layout.pinsReadOnly) return;
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      ctx.state.view.timers.delete(saveTimer);
    }
    const timer = setTimeout(() => {
      ctx.state.view.timers.delete(timer);
      saveTimer = undefined;
      save("Layout saved").catch(() => {});
    }, ctx.config.layoutSaveDelayMs);
    saveTimer = timer;
    ctx.state.view.timers.add(timer);
  }

  /**
   * Lays out again and logs instead of rejecting.
   *
   * @example
   * ```ts
   * refresh();
   * ```
   */
  function refresh(): void {
    actions.relayout().catch(() => {});
  }

  const actions: LayoutActions = {
    /**
     * Pinned items of the visible flows.
     *
     * @returns The count.
     * @example
     * ```ts
     * actions.layout.pinnedCount(); // 2
     * ```
     */
    pinnedCount() {
      return countPins(layout.pins, actions.visibleFlows());
    },

    /**
     * Clears the pins of the visible flows and writes layout.json.
     *
     * @returns Resolves when written.
     * @throws {Error} When nothing is pinned or the file is read-only.
     * @example
     * ```ts
     * await actions.layout.reset();
     * ```
     */
    async reset() {
      const flows = actions.visibleFlows();
      const count = countPins(layout.pins, flows);
      if (layout.pinsReadOnly) {
        throw new Error(
          "[moku-editor] layout.json is not valid.\n  Fix it in Files, then reset the layout."
        );
      }
      if (count === 0) {
        throw new Error(
          "[moku-editor] Nothing is pinned in the visible flows.\n  Drag a node first, then reset the layout."
        );
      }
      for (const id of Object.keys(layout.pins.nodes))
        if (flows.has(flowOfId(id))) layout.dirty.add(id);
      for (const [note, pin] of Object.entries(layout.pins.notes))
        if (flows.has(pin.flow)) layout.dirty.add(note);
      layout.pins = resetPins(layout.pins, flows);
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = undefined;
      await save(`Layout reset · ${count} pinned ${count === 1 ? "node" : "nodes"}`);
      await actions.relayout();
    },

    /**
     * Lays out the graph again.
     *
     * @returns Resolves when the result is stored (or dropped as stale).
     * @example
     * ```ts
     * await actions.layout.relayout();
     * ```
     */
    async relayout() {
      const { graph, graphHash } = ctx.state.data;
      if (graph === undefined) return;
      const root = rootFlow();
      const notes = env.actions().notes.anchors();
      const key = JSON.stringify([
        graphHash,
        root,
        [...layout.expanded].toSorted(),
        serializePins(layout.pins),
        notes,
        ctx.config.hubMinOutcomes,
        ctx.config.hubMinReturns
      ]);
      layout.seq += 1;
      const seq = layout.seq;
      let result = layout.cache.get(key);
      if (result === undefined) {
        layout.engine ??= createLazyEngine(() => realEngine(ctx));
        try {
          result = await composeLayout({
            graph,
            root,
            expanded: new Set(layout.expanded),
            pins: layout.pins,
            notes,
            config: ctx.config,
            engine: layout.engine
          });
        } catch (error) {
          ctx.log.warn("flowView: layout failed", { message: messageOf(error) });
          return;
        }
        if (seq !== layout.seq) return;
        layout.cache.set(key, result);
        while (layout.cache.size > CACHE_SIZE)
          layout.cache.delete(layout.cache.keys().next().value ?? "");
      } else {
        layout.cache.delete(key);
        layout.cache.set(key, result);
      }
      const previous = layout.result;
      layout.result = result;
      notify(ctx.state);
      settle(previous, result);
    },

    /**
     * Reads layout.json.
     *
     * @returns Resolves after the relayout.
     * @example
     * ```ts
     * await actions.layout.loadPins();
     * ```
     */
    async loadPins() {
      try {
        const file = await env.files().read(path);
        const pins = parsePins(file.text);
        layout.pinsVersion = file.version;
        layout.pinsReadOnly = pins === undefined;
        layout.pins = pins ?? emptyPins();
        if (pins === undefined) {
          ctx.log.warn("flowView: layout.json is not valid; positions are not saved", { path });
          env.toast(INVALID_PINS);
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
        layout.pins = emptyPins();
        layout.pinsVersion = undefined;
        layout.pinsReadOnly = false;
      }
      layout.dirty.clear();
      await actions.relayout();
    },

    /**
     * Pins a dropped node.
     *
     * @param key - The item key.
     * @param x - World x of the item's top-left corner.
     * @param y - World y.
     * @example
     * ```ts
     * actions.layout.drop("main/home", 640, 312);
     * ```
     */
    drop(key: ItemKey, x: number, y: number) {
      const result = layout.result;
      const item = result?.byKey[key];
      if (result === undefined || item === undefined || item.kind !== "node") return;
      const origin = result.origins[originKey(item.parent ?? "", item.flow)] ?? { x: 0, y: 0 };
      layout.pins.nodes[item.id] = { x: snap(x - origin.x), y: snap(y - origin.y) };
      layout.dirty.add(item.id);
      refresh();
      scheduleSave();
    },

    /**
     * Pins a note inside a flow frame.
     *
     * @param note - The note path.
     * @param flow - The flow it is pinned in.
     * @param x - World x.
     * @param y - World y.
     * @example
     * ```ts
     * actions.layout.dropNote(".moku/notes/a.md", "main", 300, 900);
     * ```
     */
    dropNote(note: string, flow: string, x: number, y: number) {
      const result = layout.result;
      const frame = result?.frames.find(
        entry => result.origins[originKey(entry.key, flow)] !== undefined
      );
      const origin = frame === undefined ? undefined : result?.origins[originKey(frame.key, flow)];
      if (origin === undefined) return;
      layout.pins.notes[note] = { flow, x: snap(x - origin.x), y: snap(y - origin.y) };
      layout.dirty.add(note);
      refresh();
      scheduleSave();
    },

    /**
     * The flows on screen.
     *
     * @returns Flow names.
     * @example
     * ```ts
     * actions.layout.visibleFlows(); // Set { "main", "board" }
     * ```
     */
    visibleFlows() {
      const flows = new Set<string>([rootFlow()]);
      for (const item of layout.result?.items ?? []) {
        if (item.kind !== "note" && item.kind !== "frame") flows.add(item.flow);
      }
      return flows;
    },

    /**
     * Expands the parents of a node id.
     *
     * @param id - A node id.
     * @returns The instance key it gets, or undefined.
     * @example
     * ```ts
     * actions.layout.reveal("settingsPopup/open"); // "main/settings>settingsPopup/open"
     * ```
     */
    reveal(id: NodeId) {
      const { graph } = ctx.state.data;
      const flow = flowOfId(id);
      const node = graph?.flows[flow]?.nodes[id.slice(flow.length + 1)];
      if (graph === undefined || node === undefined) return;
      const visible = layout.result?.items.find(
        item =>
          item.id === id && (item.kind === "node" || item.kind === "hub" || item.kind === "frame")
      );
      if (visible !== undefined) return visible.key;
      const chain = chainTo(graph, rootFlow(), flow);
      if (chain === undefined) return;
      let prefix = "";
      for (const parent of chain) {
        prefix = instanceKey(prefix, parent);
        layout.expanded.add(prefix);
      }
      refresh();
      return instanceKey(prefix, id);
    },

    /**
     * The root flow.
     *
     * @returns The flow name.
     * @example
     * ```ts
     * actions.layout.root(); // "main"
     * ```
     */
    root() {
      return rootFlow();
    },

    /**
     * Expands every sub-flow node on the current stack below the root.
     *
     * @example
     * ```ts
     * actions.layout.expandStack();
     * ```
     */
    expandStack() {
      const stack = env.actions().focus.stack();
      const start = stack.findIndex(entry => entry.flow === rootFlow());
      if (start === -1) return;
      let prefix = "";
      for (const entry of stack.slice(start, -1)) {
        prefix = instanceKey(prefix, entry.id);
        layout.expanded.add(prefix);
      }
    }
  };
  return actions;
}

/**
 * Creates the flows namespace (expand, collapse, enter, up).
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and the late-bound actions.
 * @returns The flows api.
 * @example
 * ```ts
 * createFlowsApi(ctx, env).enter("main/board");
 * ```
 */
export function createFlowsApi(ctx: FlowCtx, env: FlowEnvironment): FlowsApi {
  const { layout } = ctx.state;

  /**
   * The graph node behind an item key.
   *
   * @param key - The item key.
   * @returns The node, or undefined.
   * @example
   * ```ts
   * nodeAt("main/board>board/settings")?.subFlow; // "settingsPopup"
   * ```
   */
  function nodeAt(key: ItemKey): GraphJson["flows"][string]["nodes"][string] | undefined {
    const id = key.slice(key.lastIndexOf(">") + 1);
    const flow = flowOfId(id);
    return ctx.state.data.graph?.flows[flow]?.nodes[id.slice(flow.length + 1)];
  }

  /**
   * A new root: the stack defaults, the default camera again, a relayout.
   *
   * @example
   * ```ts
   * reroot();
   * ```
   */
  function reroot(): void {
    layout.expanded.clear();
    ctx.state.camera.initialised = false;
    env.actions().layout.expandStack();
    env
      .actions()
      .layout.relayout()
      .catch(() => {});
  }

  return {
    /**
     * Expands a sub-flow or slot item.
     *
     * @param key - The item key.
     * @example
     * ```ts
     * actions.flows.expand("main/settings");
     * ```
     */
    expand(key) {
      const node = nodeAt(key);
      if (node?.subFlow === undefined && node?.slot === undefined) return;
      layout.expanded.add(key);
      env
        .actions()
        .layout.relayout()
        .catch(() => {});
    },

    /**
     * Collapses an item and everything expanded inside it.
     *
     * @param key - The item key.
     * @example
     * ```ts
     * actions.flows.collapse("main/board");
     * ```
     */
    collapse(key) {
      for (const expanded of layout.expanded) {
        if (expanded === key || expanded.startsWith(`${key}>`)) layout.expanded.delete(expanded);
      }
      env
        .actions()
        .layout.relayout()
        .catch(() => {});
    },

    /**
     * Enters a sub-flow as the canvas root.
     *
     * @param key - The item key of a sub-flow node.
     * @example
     * ```ts
     * actions.flows.enter("main/board");
     * ```
     */
    enter(key) {
      const node = nodeAt(key);
      if (node?.subFlow === undefined) return;
      layout.enter.push({ flow: node.subFlow, via: key.slice(key.lastIndexOf(">") + 1) });
      reroot();
    },

    /**
     * Leaves entered flows up to a depth.
     *
     * @param depth - How many entered flows stay (0 = main).
     * @example
     * ```ts
     * actions.flows.up(0);
     * ```
     */
    up(depth) {
      if (depth < 0 || depth >= layout.enter.length) return;
      layout.enter.length = depth;
      reroot();
    }
  };
}
