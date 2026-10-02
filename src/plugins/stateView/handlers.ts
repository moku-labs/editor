/**
 * @file stateView plugin — hooks of the global tools events: link:status (reset on lost) and
 * workspace:ran (the taint from a run envelope at once).
 */
import type { ToolsEvents } from "../../config";
import type { StateViewCtx, StateViewHooks } from "./types";

/**
 * stateView's hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Domain context of stateView.
 * @example
 * ```ts
 * createToolsPlugin("stateView", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: StateViewCtx): StateViewHooks {
  throw new Error("not implemented");
}

/**
 * lost → resetTracker(ctx, "reloaded"); live and paused do nothing.
 *
 * @param _ctx - Domain context of stateView.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "lost", reason: "game_reloaded", lastFrame: 1840, retryInMs: 1000 } });
 * ```
 */
export function onLinkStatus(_ctx: StateViewCtx): (payload: ToolsEvents["link:status"]) => void {
  throw new Error("not implemented");
}

/**
 * ok → tainted = result.state.tainted; an error does nothing.
 *
 * @param _ctx - Domain context of stateView.
 * @example
 * ```ts
 * onCommandRan(ctx)(ranEvent);
 * ```
 */
export function onCommandRan(_ctx: StateViewCtx): (payload: ToolsEvents["workspace:ran"]) => void {
  throw new Error("not implemented");
}
