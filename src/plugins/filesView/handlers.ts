/**
 * @file filesView plugin — hooks of the global tools events (R4): `link:status` builds a missing
 * index, `link:project` lets the open tabs follow the project index, `workspace:changed`
 * refreshes Files when shown, `workspace:open-file` opens a file for another view.
 */
import type { ToolsEvents } from "../../config";
import { notify } from "./store";
import { followProject } from "./tabs/follow";
import { revalidate } from "./tabs/load";
import { activeTab } from "./tabs/model";
import { openOrLog } from "./tabs/open";
import { buildIndex, canList } from "./tree/walk";
import type { FilesViewCtx, FilesViewHooks } from "./types";
import { INDEX_STALE_MS } from "./types";

/**
 * filesView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of filesView.
 * @returns The four hooks.
 */
export function createHandlers(ctx: FilesViewCtx): FilesViewHooks {
  return {
    "link:status": onLinkStatus(ctx),
    "link:project": onLinkProject(ctx),
    "workspace:changed": onWorkspaceChanged(ctx),
    "workspace:open-file": handleOpenFile(ctx)
  };
}

/**
 * Builds the index when there is none, no build runs and the link can list (the first status
 * with an open socket after a failed or deferred build); notifies, since Used by and the D-07
 * reload depend on the status.
 *
 * @param ctx - Domain context of filesView.
 * @returns The `link:status` hook.
 */
export function onLinkStatus(ctx: FilesViewCtx): (payload: ToolsEvents["link:status"]) => void {
  return ({ status }) => {
    const { state } = ctx;
    const missing = state.index === undefined && state.indexing === undefined;
    if (missing && canList(status)) void buildIndex(ctx);
    notify(state);
  };
}

/**
 * A new project state: Used by re-reads it, and the open tabs follow its delta (moves, edits,
 * gone files; see followProject).
 *
 * @param ctx - Domain context of filesView.
 * @returns The `link:project` hook.
 */
export function onLinkProject(ctx: FilesViewCtx): (payload: ToolsEvents["link:project"]) => void {
  return ({ delta }) => {
    void followProject(ctx, delta);
  };
}

/**
 * Files shown: rebuilds an index older than INDEX_STALE_MS (or a missing one) and revalidates
 * the active tab.
 *
 * @param ctx - Domain context of filesView.
 * @returns The `workspace:changed` hook.
 */
export function onWorkspaceChanged(
  ctx: FilesViewCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  return ({ ws }) => {
    if (ws !== "files") return;
    const { state } = ctx;
    const stale = state.index === undefined || Date.now() - state.index.builtAt > INDEX_STALE_MS;
    if (stale && state.indexing === undefined) void buildIndex(ctx);

    const tab = activeTab(state);
    if (tab !== undefined) void revalidate(ctx, tab);
  };
}

/**
 * Opens a file another view asked for: shows Files, opens or activates the tab, reveals the
 * line. A failure is warned.
 *
 * @param ctx - Domain context of filesView.
 * @returns The `workspace:open-file` hook.
 */
export function handleOpenFile(
  ctx: FilesViewCtx
): (payload: ToolsEvents["workspace:open-file"]) => void {
  return ({ path, line }) => {
    openOrLog(ctx, path, line === undefined ? {} : { line });
  };
}
