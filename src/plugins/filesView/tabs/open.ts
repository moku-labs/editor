/**
 * @file filesView plugin — opening, closing and activating tabs. Opening shows Files, reveals
 * the path in the tree and loads the tab; closing a modified tab asks first.
 */
import { workspacePlugin } from "../../workspace";
import { messageOf } from "../errors";
import { notify } from "../store";
import { revealPath } from "../tree/model";
import type { FilesViewCtx } from "../types";
import { setEditing } from "./edit";
import { loadTab, revalidate } from "./load";
import { findTab, isModified, newTab } from "./model";

/**
 * Options of openTab.
 */
type OpenOptions = { readonly line?: number; readonly edit?: boolean };

/**
 * Shows Files, activates the tab of a path or appends one, reveals it in the tree, stores the
 * line, enters edit mode when asked (not for images), then loads a new tab (or a missing or
 * failed one again) and revalidates an open one.
 *
 * @param ctx - Domain context of filesView.
 * @param path - Relative file path.
 * @param options - `line` and `edit`.
 * @returns When the tab is loaded or checked.
 * @example
 * ```ts
 * await openTab(ctx, "nodes/merge.ts", { line: 12 });
 * ```
 */
export async function openTab(
  ctx: FilesViewCtx,
  path: string,
  options: OpenOptions
): Promise<void> {
  const { state } = ctx;
  ctx.require(workspacePlugin).show("files");

  let tab = findTab(state, path);
  const fresh = tab === undefined || tab.status === "missing" || tab.status === "error";
  if (tab === undefined) {
    tab = newTab(path);
    state.tabs.push(tab);
  }
  state.active = path;
  if (options.line !== undefined) tab.line = options.line;
  revealPath(state.expanded, path);
  if (options.edit === true) setEditing(ctx, true, path);
  notify(state);

  await (fresh ? loadTab(ctx, tab) : revalidate(ctx, tab));
}

/**
 * openTab for callers that cannot wait (palette, hooks, links): a failure is warned.
 *
 * @param ctx - Domain context of filesView.
 * @param path - Relative file path.
 * @param options - `line` and `edit`.
 * @example
 * ```ts
 * openOrLog(ctx, "flows/board.ts", { line: 3 });
 * ```
 */
export function openOrLog(ctx: FilesViewCtx, path: string, options: OpenOptions): void {
  openTab(ctx, path, options).catch((error: unknown) => {
    ctx.log.warn("filesView:open-failed", { path, message: messageOf(error) });
  });
}

/**
 * Closes a tab. A modified tab without `discard` stays and opens the discard popover. The next
 * tab to the right (else to the left) becomes active.
 *
 * @param ctx - Domain context of filesView.
 * @param path - The tab's path.
 * @param discard - Drop unsaved changes.
 * @returns Whether the tab was closed.
 * @example
 * ```ts
 * closeTab(ctx, "nodes/merge.ts", false); // false while modified
 * ```
 */
export function closeTab(ctx: FilesViewCtx, path: string, discard: boolean): boolean {
  const { state } = ctx;
  const position = state.tabs.findIndex(tab => tab.path === path);
  const tab = state.tabs[position];
  if (tab === undefined) return false;

  if (isModified(tab) && !discard) {
    state.confirmClose = path;
    notify(state);
    return false;
  }

  state.tabs.splice(position, 1);
  if (state.confirmClose === path) state.confirmClose = undefined;
  if (state.active === path) {
    state.active = (state.tabs[position] ?? state.tabs[position - 1])?.path;
  }
  notify(state);
  return true;
}

/**
 * Makes an open tab active, reveals it and revalidates it (not awaited; it never rejects).
 *
 * @param ctx - Domain context of filesView.
 * @param path - The tab's path.
 * @example
 * ```ts
 * activateTab(ctx, "flows/board.ts");
 * ```
 */
export function activateTab(ctx: FilesViewCtx, path: string): void {
  const tab = findTab(ctx.state, path);
  if (tab === undefined) return;

  ctx.state.active = path;
  revealPath(ctx.state.expanded, path);
  notify(ctx.state);
  void revalidate(ctx, tab);
}
