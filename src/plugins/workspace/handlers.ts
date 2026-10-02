/**
 * @file workspace plugin — hooks: link:status drives the pill, the stale bar and the F4 cards.
 */
import type { ToolsEvents } from "../../config";
import type { WorkspaceCtx, WorkspaceHooks } from "./types";

/**
 * The workspace's hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Domain context of workspace.
 * @example
 * ```ts
 * createToolsPlugin("workspace", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: WorkspaceCtx): WorkspaceHooks {
  throw new Error("not implemented");
}

/**
 * Stores the status, sets everLive, runs the 1 s ticker while silent or lost, bumps the UI.
 *
 * @param _ctx - Domain context of workspace.
 * @example
 * ```ts
 * handleLinkStatus(ctx)({ status: { kind: "live", frame: 1840 } });
 * ```
 */
export function handleLinkStatus(
  _ctx: WorkspaceCtx
): (payload: ToolsEvents["link:status"]) => void {
  throw new Error("not implemented");
}
