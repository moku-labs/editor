/**
 * @file panels plugin — hooks: link:status marks every mounted panel; workspace:changed mounts a
 * workspace on first show (both global tools events, R4).
 */
import type { ToolsEvents } from "../../config";
import type { PanelsCtx, PanelsHooks } from "./types";

/**
 * The panels' hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Domain context of panels.
 * @example
 * ```ts
 * createToolsPlugin("panels", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: PanelsCtx): PanelsHooks {
  throw new Error("not implemented");
}

/**
 * Stores the status and calls setStatus on every mounted panel.
 *
 * @param _ctx - Domain context of panels.
 * @example
 * ```ts
 * handleLinkStatus(ctx)({ status: { kind: "lost", reason: "socket_closed", lastFrame: 1840, retryInMs: 1000 } });
 * ```
 */
export function handleLinkStatus(_ctx: PanelsCtx): (payload: ToolsEvents["link:status"]) => void {
  throw new Error("not implemented");
}

/**
 * After start, mounts a workspace that is not mounted yet into workspace.host(ws).
 *
 * @param _ctx - Domain context of panels.
 * @example
 * ```ts
 * handleWorkspaceChanged(ctx)({ ws: "state" });
 * ```
 */
export function handleWorkspaceChanged(
  _ctx: PanelsCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  throw new Error("not implemented");
}
