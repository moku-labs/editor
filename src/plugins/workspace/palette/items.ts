/**
 * @file workspace plugin — palette/items.ts (skeleton stubs, implemented in its wave).
 */
import type { PaletteGroupView, PaletteItem, WorkspaceCtx } from "../types";

/**
 * Skeleton stub for `addPaletteItems`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _items - The items.
 * @example
 * ```ts
 * addPaletteItems();
 * ```
 */
export function addPaletteItems(
  _ctx: WorkspaceCtx,
  _items: PaletteItem | readonly PaletteItem[]
): () => void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `builtInCommands`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * builtInCommands();
 * ```
 */
export function builtInCommands(_ctx: WorkspaceCtx): readonly PaletteItem[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `groupedItems`; implemented in its wave.
 *
 * @param _items - The items.
 * @param _query - The query.
 * @example
 * ```ts
 * groupedItems();
 * ```
 */
export function groupedItems(
  _items: ReadonlyMap<string, PaletteItem>,
  _query: string
): readonly PaletteGroupView[] {
  throw new Error("not implemented");
}
