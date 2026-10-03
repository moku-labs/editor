/**
 * @file flowView focus module — the focus actions: select = focus (design §4), the neighbours of
 * the selection, the current node on the canvas, walking the strip, frames of the history, Step
 * (M5), Pause and Resume through panels.run (R9), the history strip and the context menu.
 */
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment, Item, ItemKey, NodeId, Rect } from "../types";
import { incoming, nodeOf, outgoing, parentsOf, resolveStack, splitId } from "./graph";
import { entryFrame, entryKey, trailRanks } from "./trail";
import type { CurrentSpot, FocusActions } from "./types";
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
 * @example
 * ```ts
 * firstInstance(ctx, "board/merge")?.key; // "main/board>board/merge"
 * ```
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
 * @example
 * ```ts
 * currentId(ctx); // "board/awaitIntent"
 * ```
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
 * @example
 * ```ts
 * soleParent(ctx, "board/giveToOrder"); // "main/board"
 * ```
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
 * union([a, b]); // { x, y, w, h } around both
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
 * Logs and toasts a failed command run (the Console line comes from workspace:ran).
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param id - The command id.
 * @param error - The rejection.
 * @example
 * ```ts
 * reportRun(ctx, env, "game.pause", error);
 * ```
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
 * @example
 * ```ts
 * createFocusApi(ctx, env).select("board/merge"); // true
 * ```
 */
export function createFocusApi(ctx: FlowCtx, env: FlowEnvironment): FocusActions {
  const { focus } = ctx.state;

  /**
   * Leaves focus: no selection, no edge, strip closed.
   *
   * @example
   * ```ts
   * clear();
   * ```
   */
  function clear(): void {
    focus.selected = undefined;
    focus.edge = undefined;
    focus.strip = false;
    focus.highlight = { side: "to", index: -1 };
  }

  /**
   * Selects an item key that exists in the layout (or will after a relayout).
   *
   * @param key - The item key.
   * @param item - The item when it is on screen.
   * @example
   * ```ts
   * take("main/home", item);
   * ```
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

  const actions: FocusActions = {
    /**
     * Select = focus.
     *
     * @param key - An item key, a node id, or undefined.
     * @returns False for an unknown key.
     * @example
     * ```ts
     * actions.focus.select("board/merge"); // true
     * ```
     */
    select(key) {
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

    /**
     * The selected key.
     *
     * @returns The key, or undefined.
     * @example
     * ```ts
     * actions.focus.selected();
     * ```
     */
    selected() {
      return focus.selected;
    },

    /**
     * The node id of the current position.
     *
     * @returns The id, or undefined.
     * @example
     * ```ts
     * actions.focus.current(); // "board/awaitIntent"
     * ```
     */
    current() {
      return currentId(ctx);
    },

    /**
     * Walks the strip.
     *
     * @param direction - "prev" or "next".
     * @example
     * ```ts
     * actions.focus.walk("next");
     * ```
     */
    walk(direction) {
      const { graph, history } = ctx.state.data;
      const selected =
        focus.selected === undefined ? undefined : ctx.state.layout.result?.byKey[focus.selected];
      const id = selected?.id ?? currentId(ctx);
      if (graph === undefined || id === undefined) return;
      const trail = trailRanks(history, graph, ctx.config.trailLength);
      const target = walkTarget(graph, id, direction, focus.highlight, trail, soleParent(ctx, id));
      if (target !== undefined) actions.select(target);
    },

    /**
     * Focuses the edge taken at a frame.
     *
     * @param frame - A game frame.
     * @returns False without frame data.
     * @example
     * ```ts
     * actions.focus.focusFrame(1778);
     * ```
     */
    focusFrame(frame) {
      const { graph, history } = ctx.state.data;
      const known = history.flatMap(entry => {
        const at = entryFrame(entry, focus.frames);
        return at === undefined ? [] : [{ entry, at }];
      });
      if (known.length === 0 || graph === undefined) {
        env.toast("Frames are not recorded in this history");
        return false;
      }
      const before = known.findLast(row => row.at <= frame);
      if (before === undefined) {
        env.toast(`No edge at frame ${frame}`);
        return true;
      }
      if (before.at !== frame) {
        env.toast(
          `No edge at frame ${frame} · last edge before it f${before.at} · ${before.entry.path}`
        );
        return true;
      }
      actions.selectHistory(before.entry.index);
      env.toast(`Frame ${frame} · ${before.entry.path} · ${before.entry.outcome}`);
      return true;
    },

    /**
     * Steps one frame when paused (M5).
     *
     * @returns The run result, or undefined.
     * @example
     * ```ts
     * await actions.focus.step();
     * ```
     */
    async step() {
      if (!actions.isPaused()) return;
      try {
        return await env.run("game.step", { frames: 1 });
      } catch (error) {
        reportRun(ctx, env, "game.step", error);
        return;
      }
    },

    /**
     * Toggles or sets the history strip.
     *
     * @param open - The new value; omitted = toggle.
     * @returns Whether it is open.
     * @example
     * ```ts
     * actions.focus.history();
     * ```
     */
    history(open) {
      focus.historyOpen = open ?? !focus.historyOpen;
      notify(ctx.state);
      return focus.historyOpen;
    },

    /**
     * Selects an edge and focuses its source.
     *
     * @param edge - "<id>:<outcome>".
     * @param source - The source node id.
     * @example
     * ```ts
     * actions.focus.selectEdge("board/merge:rejected", "board/merge");
     * ```
     */
    selectEdge(edge, source) {
      actions.select(source);
      focus.edge = edge;
      notify(ctx.state);
    },

    /**
     * The selected item and its neighbours.
     *
     * @returns Item keys, or undefined without a selection.
     * @example
     * ```ts
     * actions.focus.related()?.has("main/home");
     * ```
     */
    related() {
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

    /**
     * The rect of the selection and its neighbours, else of the current node.
     *
     * @returns The world rect, or undefined.
     * @example
     * ```ts
     * actions.focus.relatedRect();
     * ```
     */
    relatedRect() {
      const result = ctx.state.layout.result;
      const keys = actions.related();
      if (result === undefined) return;
      if (keys === undefined) {
        const spot = actions.locateCurrent();
        return spot === undefined ? undefined : union([spot.item]);
      }
      return union([...keys].flatMap(key => result.byKey[key] ?? []));
    },

    /**
     * Where the current node is on the canvas.
     *
     * @returns Its item, or the collapsed parent it is inside.
     * @example
     * ```ts
     * actions.focus.locateCurrent()?.inside; // "main/board" while the board is collapsed
     * ```
     */
    locateCurrent() {
      const stack = actions.stack();
      const index = stack.findLastIndex(entry => firstInstance(ctx, entry.id) !== undefined);
      const item = index === -1 ? undefined : firstInstance(ctx, stack[index]?.id ?? "");
      const spot: CurrentSpot | undefined =
        item === undefined
          ? undefined
          : { item, inside: index === stack.length - 1 ? undefined : item.id };
      return spot;
    },

    /**
     * Whether the game is paused.
     *
     * @returns True while the link status is paused.
     * @example
     * ```ts
     * actions.focus.isPaused(); // false while the game runs
     * ```
     */
    isPaused() {
      return env.status().kind === "paused";
    },

    /**
     * The runtime stack of the current position.
     *
     * @returns Stack entries, outermost first (empty before the first position).
     * @example
     * ```ts
     * actions.focus.stack().map(entry => entry.id); // ["main/board", "board/awaitIntent"]
     * ```
     */
    stack() {
      const { graph, position } = ctx.state.data;
      return graph === undefined || position === undefined
        ? []
        : resolveStack(graph, position.path);
    },

    /**
     * Moves the strip highlight to a row.
     *
     * @param side - "from" or "to".
     * @param index - The row.
     * @example
     * ```ts
     * actions.focus.highlight("to", 2);
     * ```
     */
    highlight(side, index) {
      focus.highlight = { side, index };
      notify(ctx.state);
    },

    /**
     * Moves the strip highlight up or down.
     *
     * @param delta - -1 or 1.
     * @example
     * ```ts
     * actions.focus.moveHighlight(1);
     * ```
     */
    moveHighlight(delta) {
      const { graph } = ctx.state.data;
      const selected =
        focus.selected === undefined ? undefined : ctx.state.layout.result?.byKey[focus.selected];
      if (graph === undefined || selected === undefined) return;
      const counts = {
        from: incoming(graph, selected.id).length,
        to: outgoing(graph, selected.id).length
      };
      const start = focus.highlight.index < 0 ? { ...focus.highlight, index: 0 } : focus.highlight;
      focus.highlight = focus.highlight.index < 0 ? start : moveHighlight(start, delta, counts);
      notify(ctx.state);
    },

    /**
     * Opens a context menu.
     *
     * @param menu - Target, key, outcome and position.
     * @example
     * ```ts
     * actions.focus.openMenu({ target: "canvas", key: undefined, outcome: undefined, x: 10, y: 10 });
     * ```
     */
    openMenu(menu) {
      focus.menu = menu;
      notify(ctx.state);
    },

    /**
     * Closes the context menu.
     *
     * @returns False when none was open.
     * @example
     * ```ts
     * actions.focus.closeMenu();
     * ```
     */
    closeMenu() {
      if (focus.menu === undefined) return false;
      focus.menu = undefined;
      notify(ctx.state);
      return true;
    },

    /**
     * Leaves focus (Esc layer selection).
     *
     * @returns False when nothing was selected.
     * @example
     * ```ts
     * actions.focus.leave();
     * ```
     */
    leave() {
      if (focus.selected === undefined && !focus.strip) return false;
      clear();
      notify(ctx.state);
      return true;
    },

    /**
     * Hovers a history dot.
     *
     * @param index - The entry index, or undefined.
     * @example
     * ```ts
     * actions.focus.hoverHistory(12);
     * ```
     */
    hoverHistory(index) {
      focus.historyHover = index;
      notify(ctx.state);
    },

    /**
     * Selects a history entry's edge.
     *
     * @param index - The entry index.
     * @example
     * ```ts
     * actions.focus.selectHistory(12);
     * ```
     */
    selectHistory(index) {
      const { graph, history } = ctx.state.data;
      const entry = history.find(item => item.index === index);
      if (graph === undefined || entry === undefined) return;
      focus.historySelected = index;
      const key = entryKey(entry, graph);
      const source = resolveStack(graph, entry.path).at(-1)?.id;
      if (key !== undefined && source !== undefined) actions.selectEdge(key, source);
      else notify(ctx.state);
    },

    /**
     * Pauses the game through panels.run.
     *
     * @example
     * ```ts
     * await actions.focus.pause();
     * ```
     */
    async pause() {
      try {
        await env.run("game.pause");
      } catch (error) {
        reportRun(ctx, env, "game.pause", error);
      }
    },

    /**
     * Resumes the game through panels.run.
     *
     * @example
     * ```ts
     * await actions.focus.resume();
     * ```
     */
    async resume() {
      try {
        await env.run("game.resume");
      } catch (error) {
        reportRun(ctx, env, "game.resume", error);
      }
    }
  };
  return actions;
}
