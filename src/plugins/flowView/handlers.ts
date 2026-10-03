/**
 * @file flowView plugin — hooks of the global tools events (R4): link:status, workspace:changed,
 * workspace:select-node, workspace:focus-frame, workspace:new-note.
 */
import type { ToolsEvents } from "../../config";
import type { FlowCtx, FlowHooks } from "./types";

/**
 * flowView's hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * createToolsPlugin("flowView", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: FlowCtx): FlowHooks {
  throw new Error("not implemented");
}

/**
 * Stale marking, first-live loads of layout.json and notes, empty-state reset (M4, M13).
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "silent", since: 1_790_000_000_000, lastFrame: 1840 } });
 * ```
 */
export function onLinkStatus(_ctx: FlowCtx): (payload: ToolsEvents["link:status"]) => void {
  throw new Error("not implemented");
}

/**
 * Active flag, default camera on first show (M11), closes menus when leaving.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * onWorkspaceChanged(ctx)({ ws: "flow" });
 * ```
 */
export function onWorkspaceChanged(
  _ctx: FlowCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  throw new Error("not implemented");
}

/**
 * Shows Flow, then focus.select(id); an unknown id warns.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * onSelectNode(ctx)({ id: "board/merge" });
 * ```
 */
export function onSelectNode(
  _ctx: FlowCtx
): (payload: ToolsEvents["workspace:select-node"]) => void {
  throw new Error("not implemented");
}

/**
 * Shows Flow, then focus.focusFrame(frame) with its toasts.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * onFocusFrame(ctx)({ frame: 1778 });
 * ```
 */
export function onFocusFrame(
  _ctx: FlowCtx
): (payload: ToolsEvents["workspace:focus-frame"]) => void {
  throw new Error("not implemented");
}

/**
 * Shows Flow, then notes.edit({ captures, from }): D5 with the capture row.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * onNewNote(ctx)({ captures: [".moku/captures/2026-09-24-1012-board.png"] });
 * ```
 */
export function onNewNote(_ctx: FlowCtx): (payload: ToolsEvents["workspace:new-note"]) => void {
  throw new Error("not implemented");
}
