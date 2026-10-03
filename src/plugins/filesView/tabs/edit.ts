/**
 * @file filesView plugin — edit mode, the edit buffer, preview/source, Cancel, and the closer of
 * the `fileEdit` Esc layer (discard popover first, then edit mode).
 */
import { notify } from "../store";
import type { FilesViewCtx, OpenTab } from "../types";
import { isTextKind } from "./kind";
import { activeTab, findTab } from "./model";

/**
 * The tab of a path, or the active tab without one.
 *
 * @param ctx - Domain context of filesView.
 * @param path - A tab path, or undefined for the active tab.
 * @returns The tab, or undefined.
 * @example
 * ```ts
 * targetOf(ctx, undefined)?.path; // the active path
 * ```
 */
function targetOf(ctx: FilesViewCtx, path: string | undefined): OpenTab | undefined {
  return path === undefined ? activeTab(ctx.state) : findTab(ctx.state, path);
}

/**
 * Enters or leaves edit mode. Leaving keeps the buffer. Markdown and series switch to source
 * first. Images: no-op.
 *
 * @param ctx - Domain context of filesView.
 * @param on - Edit mode on or off.
 * @param path - The tab's path; the active tab when omitted.
 * @example
 * ```ts
 * setEditing(ctx, true); // the active tab is in edit mode
 * ```
 */
export function setEditing(ctx: FilesViewCtx, on: boolean, path?: string): void {
  const tab = targetOf(ctx, path);
  if (tab === undefined || !isTextKind(tab.kind)) return;

  if (on) tab.mode = "source";
  tab.editing = on;
  notify(ctx.state);
}

/**
 * Replaces the edit buffer of a tab.
 *
 * @param ctx - Domain context of filesView.
 * @param path - The tab's path.
 * @param text - The new buffer.
 * @example
 * ```ts
 * setBuffer(ctx, "nodes/merge.ts", "export const merge = 2;\n");
 * ```
 */
export function setBuffer(ctx: FilesViewCtx, path: string, text: string): void {
  const tab = findTab(ctx.state, path);
  if (tab === undefined) return;

  tab.buffer = text;
  notify(ctx.state);
}

/**
 * Preview or source for markdown and series; other kinds stay in source.
 *
 * @param ctx - Domain context of filesView.
 * @param path - The tab's path.
 * @param mode - "preview" or "source".
 * @example
 * ```ts
 * setMode(ctx, ".moku/notes/a.md", "source");
 * ```
 */
export function setMode(ctx: FilesViewCtx, path: string, mode: "preview" | "source"): void {
  const tab = findTab(ctx.state, path);
  if (tab === undefined || (tab.kind !== "markdown" && tab.kind !== "series")) return;

  tab.mode = mode;
  notify(ctx.state);
}

/**
 * Cancel: drops the buffer (back to the text on disk) and leaves edit mode.
 *
 * @param ctx - Domain context of filesView.
 * @param path - The tab's path.
 * @example
 * ```ts
 * cancelEdit(ctx, "nodes/merge.ts");
 * ```
 */
export function cancelEdit(ctx: FilesViewCtx, path: string): void {
  const tab = findTab(ctx.state, path);
  if (tab === undefined) return;

  tab.buffer = tab.saved;
  tab.editing = false;
  notify(ctx.state);
}

/**
 * Keep: closes the discard popover without closing the tab.
 *
 * @param ctx - Domain context of filesView.
 * @example
 * ```ts
 * dismissConfirm(ctx); // ctx.state.confirmClose === undefined
 * ```
 */
export function dismissConfirm(ctx: FilesViewCtx): void {
  ctx.state.confirmClose = undefined;
  notify(ctx.state);
}

/**
 * The `fileEdit` Esc layer: closes the discard popover if open, else leaves edit mode.
 *
 * @param ctx - Domain context of filesView.
 * @returns Whether it closed something.
 * @example
 * ```ts
 * workspace.keys.escape("fileEdit", () => closeTopmost(ctx));
 * ```
 */
export function closeTopmost(ctx: FilesViewCtx): boolean {
  if (ctx.state.confirmClose !== undefined) {
    dismissConfirm(ctx);
    return true;
  }
  const tab = activeTab(ctx.state);
  if (tab?.editing !== true) return false;
  setEditing(ctx, false, tab.path);
  return true;
}
