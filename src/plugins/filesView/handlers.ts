/**
 * @file filesView plugin — hooks of the global tools events: link:status, workspace:changed,
 * workspace:open-file (R4).
 */
import type { ToolsEvents } from "../../config";
import type { FilesViewCtx, FilesViewHooks } from "./types";

/**
 * filesView's hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Domain context of filesView.
 * @example
 * ```ts
 * createToolsPlugin("filesView", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: FilesViewCtx): FilesViewHooks {
  throw new Error("not implemented");
}

/**
 * Builds the index when missing and not building; notifies.
 *
 * @param _ctx - Domain context of filesView.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "live", frame: 12 } });
 * ```
 */
export function onLinkStatus(_ctx: FilesViewCtx): (payload: ToolsEvents["link:status"]) => void {
  throw new Error("not implemented");
}

/**
 * Files shown: rebuild a stale index, revalidate the active tab.
 *
 * @param _ctx - Domain context of filesView.
 * @example
 * ```ts
 * onWorkspaceChanged(ctx)({ ws: "files" });
 * ```
 */
export function onWorkspaceChanged(
  _ctx: FilesViewCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  throw new Error("not implemented");
}

/**
 * api.open(path, { line }): shows Files, opens or activates the tab, reveals the line.
 *
 * @param _ctx - Domain context of filesView.
 * @example
 * ```ts
 * handleOpenFile(ctx)({ path: "flows/board.ts", line: 3 });
 * ```
 */
export function handleOpenFile(
  _ctx: FilesViewCtx
): (payload: ToolsEvents["workspace:open-file"]) => void {
  throw new Error("not implemented");
}
