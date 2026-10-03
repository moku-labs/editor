/**
 * @file renderView plugin — hooks of the global tools events: workspace:changed, link:status,
 * workspace:reveal.
 */
import type { ToolsEvents } from "../../config";
import type { RenderViewCtx, RenderViewHooks } from "./types";

/**
 * renderView's hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Domain context of renderView.
 * @example
 * ```ts
 * createToolsPlugin("renderView", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: RenderViewCtx): RenderViewHooks {
  throw new Error("not implemented");
}

/**
 * Render shown: scene watches on, refresh once per session. Hidden: watches off, box cleared.
 *
 * @param _ctx - Domain context of renderView.
 * @example
 * ```ts
 * onWorkspaceChanged(ctx)({ ws: "render" });
 * ```
 */
export function onWorkspaceChanged(
  _ctx: RenderViewCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  throw new Error("not implemented");
}

/**
 * Keeps data while stale; clears the session data after a session change; clears all on empty.
 *
 * @param _ctx - Domain context of renderView.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "live", frame: 12 }, session: "s-7f3a" });
 * ```
 */
export function onLinkStatus(_ctx: RenderViewCtx): (payload: ToolsEvents["link:status"]) => void {
  throw new Error("not implemented");
}

/**
 * reveal(ref).
 *
 * @param _ctx - Domain context of renderView.
 * @example
 * ```ts
 * onReveal(ctx)({ ref: { kind: "ui", path: "column#0/hudRow/coins" } });
 * ```
 */
export function onReveal(_ctx: RenderViewCtx): (payload: ToolsEvents["workspace:reveal"]) => void {
  throw new Error("not implemented");
}
