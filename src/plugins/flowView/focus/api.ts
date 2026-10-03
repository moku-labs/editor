/**
 * @file flowView focus module — the focus actions: select = focus (design §4), the neighbours of
 * the selection, the current node on the canvas, walking the strip, frames of the history, Step
 * (M5), Pause and Resume through panels.run (R9), the history strip and the context menu.
 */
import { notify } from "../state";
import type {
  FlowCtx,
  FlowEnvironment,
  HistoryEntryJson,
  Item,
  ItemKey,
  NodeId,
  Rect
} from "../types";
import { incoming, nodeOf, outgoing, parentsOf, resolveStack, splitId } from "./graph";
import { entryFrame, entryKey, trailRanks } from "./trail";
import type { FocusActions } from "./types";
import { moveHighlight, walkTarget } from "./walk";

/**
 * Item kinds that stand for a graph node.
 */
const NODE_KINDS: ReadonlySet<Item["kind"]> = new Set(["node", "hub", "frame"]);

/**
 * The first visible instance of a node id (root frame first, then frames in layout order).
 *
 * @param ctx - Domain context of flowView.
 * @param id - A node id.
 * @returns The item, or undefined.
 */
function firstInstance(ctx: FlowCtx, id: NodeId): Item | undefined {
  return ctx.state.layout.result?.items.find(
    item => item.id === id && NODE_KINDS.has(item.kind) && !item.key.startsWith("#")
  );
}

/**
 * The node id of the current position.
 *
 * @param ctx - Domain context of flowView.
 * @returns The id, or undefined.
 */
function currentId(ctx: FlowCtx): NodeId | undefined {
  const { graph, position } = ctx.state.data;
  if (graph === undefined || position === undefined) return undefined;
  return resolveStack(graph, position.path).at(-1)?.id;
}

/**
 * The parent sub-flow node of a flow when exactly one instance of it is on screen.
 *
 * @param ctx - Domain context of flowView.
 * @param id - A node id inside the flow.
 * @returns The parent node id, or undefined.
 */
function soleParent(ctx: FlowCtx, id: NodeId): NodeId | undefined {
  const { graph } = ctx.state.data;
  const result = ctx.state.layout.result;
  if (graph === undefined || result === undefined) return undefined;
  const parents = new Set(parentsOf(graph, splitId(id).flow));
  const onScreen = result.frames.filter(frame => parents.has(frame.id));
  return onScreen.length === 1 ? onScreen[0]?.id : undefined;
}

/**
 * The union of item rects.
 *
 * @param items - Items.
 * @returns The rect, or undefined for none.
 * @example
 * ```ts
 * union([
 *   { key: "a", x: 0, y: 0, w: 100, h: 50, … },
 *   { key: "b", x: 200, y: 80, w: 100, h: 50, … }
 * ]); // { x: 0, y: 0, w: 300, h: 130 }
 * ```
 */
function union(items: readonly Item[]): Rect | undefined {
  if (items.length === 0) return undefined;
  const left = Math.min(...items.map(item => item.x));
  const top = Math.min(...items.map(item => item.y));
  const right = Math.max(...items.map(item => item.x + item.w));
  const bottom = Math.max(...items.map(item => item.y + item.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The history entries whose frame is known (their own, or seen live), oldest first.
 *
 * @param history - Entries, oldest first.
 * @param frames - Entry index → frame seen live.
 * @returns Each entry with its frame.
 * @example
 * ```ts
 * const rows = framedEntries([{ index: 4, … }, { index: 5, frame: 1778, … }], new Map());
 * rows.map(row => row.at); // [1778]: entry 4 has no known frame
 * ```
 */
function framedEntries(
  history: readonly HistoryEntryJson[],
  frames: ReadonlyMap<number, number>
): { readonly entry: HistoryEntryJson; readonly at: number }[] {
  return history.flatMap(entry => {
    const at = entryFrame(entry, frames);
    return at === undefined ? [] : [{ entry, at }];
  });
}

/**
 * Logs and toasts a failed command run (the Console line comes from workspace:ran).
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param id - The command id.
 * @param error - The rejection.
 */
function reportRun(ctx: FlowCtx, env: FlowEnvironment, id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  ctx.log.warn("flowView: command failed", { id, message });
  env.toast(`${id} failed · Logged in Console`);
}

/**
 * Creates the focus actions.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and the late-bound actions.
 * @returns The focus actions.
 */
export function createFocusApi(ctx: FlowCtx, env: FlowEnvironment): FocusActions {
  const { focus } = ctx.state;

  /**
   * Leaves focus: no selection, no edge, strip closed.
   */
  function clear(): void {
    focus.selected = undefined;
    focus.edge = undefined;
    focus.strip = false;
    focus.highlight = { side: "to", index: -1 };
  }

  /**
   * Selects an item key that exists in the layout (or will after a relayout); a note opens no
   * strip, an item on screen gets the focus move.
   *
   * @param key - The item key.
   * @param item - The item when it is on screen.
   */
  function take(key: ItemKey, item?: Item): void {
    focus.selected = key;
    focus.edge = undefined;
    focus.strip = item === undefined || item.kind !== "note";
    focus.highlight = { side: "to", index: -1 };
    focus.menu = undefined;
    notify(ctx.state);
    if (item !== undefined) env.actions().camera.focusItem(item);
  }

  /**
   * The selected item on screen.
   *
   * @returns The item, or undefined without a selection or before its layout.
   */
  function selectedItem(): Item | undefined {
    return focus.selected === undefined
      ? undefined
      : ctx.state.layout.result?.byKey[focus.selected];
  }

  const actions: FocusActions = {
    select: key => {
      if (key === undefined) {
        clear();
        notify(ctx.state);
        return true;
      }
      const item = ctx.state.layout.result?.byKey[key] ?? firstInstance(ctx, key);
      if (item !== undefined) {
        take(item.key, item);
        return true;
      }
      const { graph } = ctx.state.data;
      if (graph === undefined || nodeOf(graph, key) === undefined) return false;
      const revealed = env.actions().layout.reveal(key);
      if (revealed === undefined) return false;
      take(revealed);
      return true;
    },

    selected: () => focus.selected,

    current: () => currentId(ctx),

    walk: direction => {
      const { graph, history } = ctx.state.data;
      const id = selectedItem()?.id ?? currentId(ctx);
      if (graph === undefined || id === undefined) return;
      const trail = trailRanks(history, graph, ctx.config.trailLength);
      const target = walkTarget(graph, id, direction, focus.highlight, trail, soleParent(ctx, id));
      if (target !== undefined) actions.select(target);
    },

    focusFrame: frame => {
      const { graph, history } = ctx.state.data;
      const known = framedEntries(history, focus.frames);
      if (known.length === 0 || graph === undefined) {
        env.toast("Frames are not recorded in this history");
        return false;
      }

      // The last edge at or before the frame; only an exact match is selected.
      const before = known.findLast(row => row.at <= frame);
      if (before === undefined) {
        env.toast(`No edge at frame ${frame}`);
        return true;
      }
      const { entry, at } = before;
      if (at !== frame) {
        env.toast(`No edge at frame ${frame} · last edge before it f${at} · ${entry.path}`);
        return true;
      }

      actions.selectHistory(entry.index);
      env.toast(`Frame ${frame} · ${entry.path} · ${entry.outcome}`);
      return true;
    },

    step: async () => {
      if (!actions.isPaused()) return;
      try {
        return await env.run("game.step", { frames: 1 });
      } catch (error) {
        reportRun(ctx, env, "game.step", error);
        return;
      }
    },

    history: open => {
      focus.historyOpen = open ?? !focus.historyOpen;
      notify(ctx.state);
      return focus.historyOpen;
    },

    selectEdge: (edge, source) => {
      actions.select(source);
      focus.edge = edge;
      notify(ctx.state);
    },

    related: () => {
      const selected = focus.selected;
      const result = ctx.state.layout.result;
      if (selected === undefined || result === undefined) return;
      const keys = new Set<ItemKey>([selected]);
      for (const edge of result.edges) {
        if (edge.kind === "return") continue;
        if (edge.from === selected && edge.to !== undefined) keys.add(edge.to);
        if (edge.to === selected) keys.add(edge.from);
      }
      return keys;
    },

    relatedRect: () => {
      const result = ctx.state.layout.result;
      const keys = actions.related();
      if (result === undefined) return;
      if (keys === undefined) {
        const spot = actions.locateCurrent();
        return spot === undefined ? undefined : union([spot.item]);
      }
      return union([...keys].flatMap(key => result.byKey[key] ?? []));
    },

    locateCurrent: () => {
      const stack = actions.stack();
      // The deepest stack level with an instance on screen: the current node itself, or the
      // collapsed parent the current node sits inside.
      const shown = stack
        .map((entry, index) => ({ index, item: firstInstance(ctx, entry.id) }))
        .findLast(level => level.item !== undefined);
      if (shown?.item === undefined) return;
      const isCurrent = shown.index === stack.length - 1;
      return { item: shown.item, inside: isCurrent ? undefined : shown.item.id };
    },

    isPaused: () => env.status().kind === "paused",

    stack: () => {
      const { graph, position } = ctx.state.data;
      return graph === undefined || position === undefined
        ? []
        : resolveStack(graph, position.path);
    },

    highlight: (side, index) => {
      focus.highlight = { side, index };
      notify(ctx.state);
    },

    moveHighlight: delta => {
      const { graph } = ctx.state.data;
      const selected = selectedItem();
      if (graph === undefined || selected === undefined) return;

      // The first press highlights row 0 of the column; later presses move inside it.
      const unset = focus.highlight.index < 0;
      focus.highlight = unset
        ? { ...focus.highlight, index: 0 }
        : moveHighlight(focus.highlight, delta, {
            from: incoming(graph, selected.id).length,
            to: outgoing(graph, selected.id).length
          });
      notify(ctx.state);
    },

    openMenu: menu => {
      focus.menu = menu;
      notify(ctx.state);
    },

    closeMenu: () => {
      if (focus.menu === undefined) return false;
      focus.menu = undefined;
      notify(ctx.state);
      return true;
    },

    leave: () => {
      if (focus.selected === undefined && !focus.strip) return false;
      clear();
      notify(ctx.state);
      return true;
    },

    hoverHistory: index => {
      focus.historyHover = index;
      notify(ctx.state);
    },

    selectHistory: index => {
      const { graph, history } = ctx.state.data;
      const entry = history.find(item => item.index === index);
      if (graph === undefined || entry === undefined) return;
      focus.historySelected = index;
      const key = entryKey(entry, graph);
      const source = resolveStack(graph, entry.path).at(-1)?.id;
      if (key !== undefined && source !== undefined) actions.selectEdge(key, source);
      else notify(ctx.state);
    },

    pause: async () => {
      try {
        await env.run("game.pause");
      } catch (error) {
        reportRun(ctx, env, "game.pause", error);
      }
    },

    resume: async () => {
      try {
        await env.run("game.resume");
      } catch (error) {
        reportRun(ctx, env, "game.resume", error);
      }
    }
  };
  return actions;
}
