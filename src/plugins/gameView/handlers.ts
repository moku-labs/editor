/**
 * @file gameView plugin — hooks of the global tools events: link:status, workspace:changed,
 * workspace:open-sheet, workspace:inspect (R9).
 */
import type { ToolsEvents } from "../../config";
import type { GameViewCtx, GameViewHooks } from "./types";

/**
 * gameView's hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * createToolsPlugin("gameView", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: GameViewCtx): GameViewHooks {
  throw new Error("not implemented");
}

/**
 * Keeps the scene while stale; drops scene, calibration and manifest after a new session; picker
 * off and series ended on empty.
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "empty" } });
 * ```
 */
export function onLinkStatus(_ctx: GameViewCtx): (payload: ToolsEvents["link:status"]) => void {
  throw new Error("not implemented");
}

/**
 * Entering Game starts the scene watches; leaving stops them and turns the picker off.
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * onWorkspaceChanged(ctx)({ ws: "game" });
 * ```
 */
export function onWorkspaceChanged(
  _ctx: GameViewCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  throw new Error("not implemented");
}

/**
 * openSheet(index).
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * onOpenSheet(ctx)({ index: ".moku/captures/series-2026-09-24-1015/index.json" });
 * ```
 */
export function onOpenSheet(
  _ctx: GameViewCtx
): (payload: ToolsEvents["workspace:open-sheet"]) => void {
  throw new Error("not implemented");
}

/**
 * Shows Game, then inspect(ref) (R9).
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * onInspect(ctx)({ ref: { kind: "entity", id: 1_048_580 } });
 * ```
 */
export function onInspect(_ctx: GameViewCtx): (payload: ToolsEvents["workspace:inspect"]) => void {
  throw new Error("not implemented");
}
