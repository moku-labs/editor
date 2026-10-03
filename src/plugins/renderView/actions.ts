/**
 * @file renderView plugin — what the api, the hooks and the components do to the state: reveal,
 * select, open and close tree rows, sort and filter the textures table, ring an element over the
 * game frame, inspect it in Game and the Textures palette items.
 */

import type { ElementRef } from "../panels/shared/scene";
import { ancestorsOf, refId } from "../panels/shared/scene";
import { workspacePlugin } from "../workspace";
import { firstNodeWithTexture, nextSort } from "./derive";
import { drawBox } from "./overlay";
import { notify } from "./state";
import type { RenderViewCtx, RenderViewState, TextureSortKey, TreeRow } from "./types";

/**
 * Opens every ancestor of a node and selects it.
 *
 * @param state - renderView state (`scene`, `tree`).
 * @param id - The node id.
 */
function selectWithAncestors(state: RenderViewState, id: string): void {
  if (state.scene !== undefined) {
    for (const ancestor of ancestorsOf(state.scene, id)) state.tree.open.add(ancestor);
  }
  state.tree.selected = id;
}

/**
 * Shows Render and selects the element with its ancestors open; before the first scene, or when
 * the element is not in the current scene, the ref waits for the next scene.
 *
 * @param ctx - Domain context of renderView.
 * @param ref - The element.
 */
export function revealRef(ctx: RenderViewCtx, ref: ElementRef): void {
  const { state } = ctx;
  const id = refId(ref);

  ctx.require(workspacePlugin).show("render");
  if (state.scene?.nodes.has(id) === true) {
    state.pendingReveal = undefined;
    selectWithAncestors(state, id);
  } else {
    state.pendingReveal = ref;
  }
  notify(state);
}

/**
 * Applies a waiting reveal to the scene just built (selected even when it is not in it).
 *
 * @param ctx - Domain context of renderView.
 */
export function applyPendingReveal(ctx: RenderViewCtx): void {
  const { state } = ctx;
  if (state.pendingReveal === undefined) return;

  const id = refId(state.pendingReveal);
  state.pendingReveal = undefined;
  selectWithAncestors(state, id);
}

/**
 * Selects a tree row.
 *
 * @param ctx - Domain context of renderView.
 * @param id - The node id.
 */
export function selectNode(ctx: RenderViewCtx, id: string): void {
  ctx.state.tree.selected = id;
  notify(ctx.state);
}

/**
 * Opens or closes a tree row.
 *
 * @param ctx - Domain context of renderView.
 * @param id - The node id.
 * @param open - Open (true), close (false), or flip (undefined).
 */
export function setOpen(ctx: RenderViewCtx, id: string, open?: boolean): void {
  const { tree } = ctx.state;
  const next = open ?? !tree.open.has(id);

  if (next) tree.open.add(id);
  else tree.open.delete(id);
  notify(ctx.state);
}

/**
 * Opens every scene node with children (C9 "Expand all").
 *
 * @param ctx - Domain context of renderView.
 */
export function expandAll(ctx: RenderViewCtx): void {
  const { state } = ctx;
  for (const node of state.scene?.nodes.values() ?? []) {
    if (node.children.length > 0) state.tree.open.add(node.id);
  }
  notify(state);
}

/**
 * Closes every row (C9 "Collapse").
 *
 * @param ctx - Domain context of renderView.
 */
export function collapseAll(ctx: RenderViewCtx): void {
  ctx.state.tree.open.clear();
  notify(ctx.state);
}

/**
 * Sorts the textures table by a column (same key flips the direction).
 *
 * @param ctx - Domain context of renderView.
 * @param key - The column.
 */
export function sortBy(ctx: RenderViewCtx, key: TextureSortKey): void {
  const { table } = ctx.state;
  const next = nextSort(table, key);

  table.sort = next.sort;
  table.dir = next.dir;
  notify(ctx.state);
}

/**
 * Filters the textures table by bundle ("all" for none).
 *
 * @param ctx - Domain context of renderView.
 * @param bundle - "all" or a bundle name.
 */
export function filterTo(ctx: RenderViewCtx, bundle: string): void {
  ctx.state.table.bundle = bundle;
  notify(ctx.state);
}

/**
 * Rings an element over the game frame, or clears the ring.
 *
 * @param ctx - Domain context of renderView.
 * @param ref - The element, or undefined.
 */
export function highlightRef(ctx: RenderViewCtx, ref?: ElementRef): void {
  ctx.state.box = ref;
  drawBox(ctx);
}

/**
 * Hovers a texture row: rings the first scene node drawing it (none: no ring).
 *
 * @param ctx - Domain context of renderView.
 * @param key - The texture key, or undefined on leave.
 */
export function hoverTexture(ctx: RenderViewCtx, key?: string): void {
  const { state } = ctx;
  state.table.hover = key;
  highlightRef(ctx, key === undefined ? undefined : firstNodeWithTexture(state.scene, key)?.ref);
}

/**
 * Asks the Game workspace to inspect an element (R9: gameView hooks `workspace:inspect`).
 *
 * @param ctx - Domain context of renderView.
 * @param ref - The element.
 */
export function inspectInGame(ctx: RenderViewCtx, ref: ElementRef): void {
  ctx.emit("workspace:inspect", { ref });
}

/**
 * Replaces the Textures palette items with one per catalogue texture: it shows Render, filters
 * the table to its bundle and reveals the first scene node drawing it.
 *
 * @param ctx - Domain context of renderView.
 */
export function setTexturePalette(ctx: RenderViewCtx): void {
  const { state } = ctx;
  state.palette?.();
  state.palette = undefined;
  if (state.catalogue === null || state.catalogue === undefined) return;

  const workspace = ctx.require(workspacePlugin);
  const items = [...state.catalogue.textures.values()].map(texture => ({
    id: `render.texture.${texture.key}`,
    group: "Textures" as const,
    label: texture.key,
    mono: true,
    hint: `${texture.bundle} · ${texture.width}×${texture.height}`,
    /**
     * Shows Render, filters the table to the texture's bundle and reveals the first node drawing it.
     */
    run: () => {
      workspace.show("render");
      filterTo(ctx, texture.bundle);
      const node = firstNodeWithTexture(state.scene, texture.key);
      if (node !== undefined) revealRef(ctx, node.ref);
    }
  }));
  state.palette = workspace.palette.add(items);
}

/**
 * Selects a row when there is one; always reports the key as handled.
 *
 * @param ctx - Domain context of renderView.
 * @param target - The row to select, if any.
 * @returns True.
 */
function selectRow(ctx: RenderViewCtx, target: TreeRow | undefined): true {
  if (target !== undefined) selectNode(ctx, target.id);
  return true;
}

/**
 * Moves through the visible tree rows with a key: ↓/↑ next/previous, Home/End first/last, → opens
 * a closed row or steps into an open one, ← closes an open row or steps to its parent.
 *
 * @param ctx - Domain context of renderView.
 * @param rows - The visible rows.
 * @param key - `KeyboardEvent.key`.
 * @returns Whether the key was handled.
 */
export function moveInTree(ctx: RenderViewCtx, rows: readonly TreeRow[], key: string): boolean {
  const { tree, scene } = ctx.state;
  const index = rows.findIndex(row => row.id === tree.selected);
  const row = rows[index];

  switch (key) {
    case "ArrowDown": {
      return selectRow(ctx, rows[index + 1] ?? rows[index] ?? rows[0]);
    }
    case "ArrowUp": {
      return selectRow(ctx, index <= 0 ? rows[0] : rows[index - 1]);
    }
    case "Home": {
      return selectRow(ctx, rows[0]);
    }
    case "End": {
      return selectRow(ctx, rows.at(-1));
    }
    case "ArrowRight": {
      if (row?.hasChildren !== true) return true;
      if (row.open) return selectRow(ctx, rows[index + 1]);
      setOpen(ctx, row.id, true);
      return true;
    }
    case "ArrowLeft": {
      if (row === undefined) return true;
      if (row.open) {
        setOpen(ctx, row.id, false);
        return true;
      }
      const parent = scene?.nodes.get(row.id)?.parent;
      if (parent !== undefined) selectNode(ctx, parent);
      return true;
    }
    default: {
      return false;
    }
  }
}
