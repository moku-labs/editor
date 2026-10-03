/**
 * @file flowView layout module — the layout actions (relayout with cache and stale-result drop,
 * the lazy ELK engine, pins load/drop/save/reset with version checks) and the flows namespace
 * (expand, collapse, enter, up).
 */
import type { FilesClient } from "../../link/types";
import { bareMessage, errorCode, isWireError } from "../../registry/protocol";
import { notify } from "../state";
import type {
  FlowCtx,
  FlowEnvironment,
  GraphJson,
  ItemKey,
  LayoutResult,
  NodeId,
  NoteAnchor
} from "../types";
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
 */
export function createLayoutApi(ctx: FlowCtx, env: FlowEnvironment): LayoutActions {
  const { layout } = ctx.state;
  const path = ctx.config.layoutFile;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The root flow: the last entered flow, else the graph's main flow.
   *
   * @returns The flow name.
   */
  function rootFlow(): string {
    return layout.enter.at(-1)?.flow ?? ctx.state.data.graph?.main ?? "main";
  }

  /**
   * The cache key of a layout: every input the composition reads.
   *
   * @param root - The root flow.
   * @param notes - The note anchors.
   * @returns The key.
   */
  function cacheKey(root: string, notes: readonly NoteAnchor[]): string {
    return JSON.stringify([
      ctx.state.data.graphHash,
      root,
      [...layout.expanded].toSorted(),
      serializePins(layout.pins),
      notes,
      ctx.config.hubMinOutcomes,
      ctx.config.hubMinReturns
    ]);
  }

  /**
   * Composes a layout with the lazy ELK engine (created on the first call); a failure is logged.
   *
   * @param graph - The graph.
   * @param root - The root flow.
   * @param notes - The note anchors.
   * @returns The result, or undefined when the layout failed.
   */
  async function compose(
    graph: GraphJson,
    root: string,
    notes: readonly NoteAnchor[]
  ): Promise<LayoutResult | undefined> {
    layout.engine ??= createLazyEngine(() => realEngine(ctx));
    try {
      return await composeLayout({
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
      return undefined;
    }
  }

  /**
   * Keeps a result as the newest cache entry, dropping the oldest beyond CACHE_SIZE.
   *
   * @param key - The cache key.
   * @param result - The result.
   */
  function remember(key: string, result: LayoutResult): void {
    layout.cache.delete(key);
    layout.cache.set(key, result);
    while (layout.cache.size > CACHE_SIZE)
      layout.cache.delete(layout.cache.keys().next().value ?? "");
  }

  /**
   * After a new result: the default camera once, the camera onto a selection that just appeared.
   *
   * @param previous - The result before.
   * @param result - The new result.
   */
  function settle(previous: LayoutResult | undefined, result: LayoutResult): void {
    const camera = env.actions().camera;
    if (env.active() && !ctx.state.camera.initialised) camera.applyDefault();
    const selected = ctx.state.focus.selected;
    const item = selected === undefined ? undefined : result.byKey[selected];
    if (item !== undefined && previous?.byKey[item.key] === undefined) camera.focusItem(item);
  }

  /**
   * Records a successful write: the new version, nothing dirty, the toast naming the file (M12).
   *
   * @param version - The version the write returned.
   * @param message - The toast.
   */
  function markSaved(version: string, message: string): void {
    layout.pinsVersion = version;
    layout.dirty.clear();
    env.toast(message, path);
  }

  /**
   * The second write after a version conflict: re-reads layout.json, re-applies the dirty ids and
   * writes once more. An invalid file turns read-only; a second conflict reloads the file.
   *
   * @param files - link.files.
   * @param message - The toast of a successful write.
   * @returns Resolves when written, or when the file was reloaded.
   */
  async function writeAfterConflict(files: FilesClient, message: string): Promise<void> {
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
      markSaved(written.version, message);
      await actions.relayout();
    } catch (error) {
      if (!isConflict(error)) throw error;
      env.toast("layout.json changed on disk · your move was not saved");
      await actions.loadPins();
    }
  }

  /**
   * Writes the pins with the version they were read at; a conflict goes to the second write, any
   * other failure is logged and toasted.
   *
   * @param message - The toast of a successful write.
   * @returns Resolves when the save settled.
   */
  async function writePins(message: string): Promise<void> {
    const files = env.files();
    try {
      const written = await files.write(path, serializePins(layout.pins), layout.pinsVersion);
      markSaved(written.version, message);
      return;
    } catch (error) {
      if (!isConflict(error)) {
        ctx.log.warn("flowView: layout.json was not written", { path, message: messageOf(error) });
        env.toast(`Layout not saved · ${bareMessage(messageOf(error))}`, path);
        return;
      }
    }
    await writeAfterConflict(files, message);
  }

  /**
   * Runs one save and remembers it in `layout.saving` (onStop waits for it).
   *
   * @param message - The toast of a successful write.
   * @returns The save.
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
   * Debounces the save after a drop (layoutSaveDelayMs); a read-only layout.json is never written.
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
   * Lays out again without waiting; relayout logs its own failures.
   */
  function refresh(): void {
    actions.relayout().catch(() => {});
  }

  const actions: LayoutActions = {
    pinnedCount: () => countPins(layout.pins, actions.visibleFlows()),

    reset: async () => {
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

    relayout: async () => {
      const { graph } = ctx.state.data;
      if (graph === undefined) return;
      const root = rootFlow();
      const notes = env.actions().notes.anchors();
      const key = cacheKey(root, notes);
      layout.seq += 1;
      const seq = layout.seq;

      // A cache miss composes; a failed layout or a newer relayout started meanwhile drops it.
      let result = layout.cache.get(key);
      if (result === undefined) {
        result = await compose(graph, root, notes);
        if (result === undefined || seq !== layout.seq) return;
      }
      remember(key, result);

      const previous = layout.result;
      layout.result = result;
      notify(ctx.state);
      settle(previous, result);
    },

    loadPins: async () => {
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

    drop: (key, x, y) => {
      const result = layout.result;
      const item = result?.byKey[key];
      if (result === undefined || item === undefined || item.kind !== "node") return;
      const origin = result.origins[originKey(item.parent ?? "", item.flow)] ?? { x: 0, y: 0 };
      layout.pins.nodes[item.id] = { x: snap(x - origin.x), y: snap(y - origin.y) };
      layout.dirty.add(item.id);
      refresh();
      scheduleSave();
    },

    dropNote: (note, flow, x, y) => {
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

    visibleFlows: () => {
      const flows = new Set<string>([rootFlow()]);
      for (const item of layout.result?.items ?? []) {
        if (item.kind !== "note" && item.kind !== "frame") flows.add(item.flow);
      }
      return flows;
    },

    reveal: id => {
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

    root: () => rootFlow(),

    expandStack: () => {
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
 */
export function createFlowsApi(ctx: FlowCtx, env: FlowEnvironment): FlowsApi {
  const { layout } = ctx.state;

  /**
   * The graph node behind an item key.
   *
   * @param key - The item key.
   * @returns The node, or undefined.
   */
  function nodeAt(key: ItemKey): GraphJson["flows"][string]["nodes"][string] | undefined {
    const id = key.slice(key.lastIndexOf(">") + 1);
    const flow = flowOfId(id);
    return ctx.state.data.graph?.flows[flow]?.nodes[id.slice(flow.length + 1)];
  }

  /**
   * Lays out again without waiting; relayout logs its own failures.
   */
  function relayout(): void {
    env
      .actions()
      .layout.relayout()
      .catch(() => {});
  }

  /**
   * A new root: the stack defaults, the default camera again, a relayout.
   */
  function reroot(): void {
    layout.expanded.clear();
    ctx.state.camera.initialised = false;
    env.actions().layout.expandStack();
    relayout();
  }

  return {
    expand: key => {
      const node = nodeAt(key);
      if (node?.subFlow === undefined && node?.slot === undefined) return;
      layout.expanded.add(key);
      relayout();
    },

    collapse: key => {
      // The item and everything expanded inside it.
      for (const expanded of layout.expanded) {
        if (expanded === key || expanded.startsWith(`${key}>`)) layout.expanded.delete(expanded);
      }
      relayout();
    },

    enter: key => {
      const node = nodeAt(key);
      if (node?.subFlow === undefined) return;
      layout.enter.push({ flow: node.subFlow, via: key.slice(key.lastIndexOf(">") + 1) });
      reroot();
    },

    up: depth => {
      if (depth < 0 || depth >= layout.enter.length) return;
      layout.enter.length = depth;
      reroot();
    }
  };
}
