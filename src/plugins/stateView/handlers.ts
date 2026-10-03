/**
 * @file stateView plugin — hooks of the global tools events: link:status (reset on lost) and
 * workspace:ran (the taint from a run envelope at once, before the game.tainted watch delivers).
 */
import type { ToolsEvents } from "../../config";
import { notify, resetTracker } from "./tracker";
import type { StateViewCtx, StateViewHooks } from "./types";

/**
 * stateView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of stateView.
 * @returns The two hooks.
 * @example
 * ```ts
 * createToolsPlugin("stateView", { hooks: createHandlers });
 * ```
 */
export function createHandlers(ctx: StateViewCtx): StateViewHooks {
  return { "link:status": onLinkStatus(ctx), "workspace:ran": onCommandRan(ctx) };
}

/**
 * The link:status hook: lost resets the tracker with the note "reloaded"; every other kind does
 * nothing (the watched values drive the tracker).
 *
 * @param ctx - Domain context of stateView.
 * @returns The handler.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "lost", reason: "game_reloaded", lastFrame: 1840, retryInMs: 1000 } });
 * ```
 */
export function onLinkStatus(ctx: StateViewCtx): (payload: ToolsEvents["link:status"]) => void {
  return ({ status }) => {
    if (status.kind === "lost") resetTracker(ctx, "reloaded");
  };
}

/**
 * The workspace:ran hook: a settled run stores `result.state.tainted` and notifies; a failed run
 * does nothing.
 *
 * @param ctx - Domain context of stateView.
 * @returns The handler.
 * @example
 * ```ts
 * onCommandRan(ctx)({ id: "game.step", input: { frames: 1 }, origin: "topbar", at: 1, ok: true, result });
 * ```
 */
export function onCommandRan(ctx: StateViewCtx): (payload: ToolsEvents["workspace:ran"]) => void {
  return payload => {
    if (!payload.ok) return;
    ctx.state.tainted = payload.result.state.tainted;
    notify(ctx.state);
  };
}
