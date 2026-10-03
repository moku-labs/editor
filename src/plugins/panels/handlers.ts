/**
 * @file panels plugin — hooks: link:status marks every mounted panel; workspace:changed mounts a
 * workspace on first show (both global tools events, R4).
 */
import type { ToolsEvents } from "../../config";
import { workspacePlugin } from "../workspace";
import { mountWorkspace } from "./api";
import type { PanelsCtx, PanelsHooks } from "./types";

/**
 * The panels' hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of panels.
 * @returns The two hooks.
 * @example
 * ```ts
 * createToolsPlugin("panels", { hooks: createHandlers });
 * ```
 */
export function createHandlers(ctx: PanelsCtx): PanelsHooks {
  return {
    "link:status": handleLinkStatus(ctx),
    "workspace:changed": handleWorkspaceChanged(ctx)
  };
}

/**
 * Stores the status and calls setStatus on every mounted panel.
 *
 * @param ctx - Domain context of panels.
 * @returns The `link:status` hook.
 * @example
 * ```ts
 * handleLinkStatus(ctx)({ status: { kind: "lost", reason: "socket_closed", lastFrame: 1840, retryInMs: 1000 } });
 * ```
 */
export function handleLinkStatus(ctx: PanelsCtx): (payload: ToolsEvents["link:status"]) => void {
  return ({ status }) => {
    ctx.state.status = status;
    for (const record of ctx.state.mounted.values()) {
      for (const panel of record.panels.values()) panel.setStatus(status);
    }
  };
}

/**
 * After start, mounts a workspace that is not mounted yet into workspace.host(ws).
 *
 * @param ctx - Domain context of panels.
 * @returns The `workspace:changed` hook.
 * @example
 * ```ts
 * handleWorkspaceChanged(ctx)({ ws: "state" });
 * ```
 */
export function handleWorkspaceChanged(
  ctx: PanelsCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  return ({ ws }) => {
    if (!ctx.state.started || ctx.state.mounted.has(ws)) return;
    mountWorkspace(ctx, ws, ctx.require(workspacePlugin).host(ws));
  };
}
