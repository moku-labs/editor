/**
 * @file stateView plugin — onInit (register the State panel), onStart (manifest listener, the
 * game.model and game.tainted watches for the whole session) and onStop (drop them).
 */
import type { StateViewCtx, StateViewState } from "./types";

/**
 * onInit: panels.register(createStatePanel(ctx)).
 *
 * @param _ctx - Domain context of stateView.
 * @example
 * ```ts
 * createToolsPlugin("stateView", { onInit: registerStatePanel });
 * ```
 */
export function registerStatePanel(_ctx: StateViewCtx): void {
  throw new Error("not implemented");
}

/**
 * onStart: link.onManifest, link.watch("game.model"), link.watch("game.tainted") (R6).
 *
 * @param _ctx - Domain context of stateView.
 * @example
 * ```ts
 * createToolsPlugin("stateView", { onStart: startStateView });
 * ```
 */
export function startStateView(_ctx: StateViewCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: stopModel, stopTainted, stopManifest, listeners cleared.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("stateView", { onStop: stopStateView });
 * ```
 */
export function stopStateView(_ctx: { readonly state: StateViewState }): void {
  throw new Error("not implemented");
}
