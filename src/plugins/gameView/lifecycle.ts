/**
 * @file gameView plugin — onInit (panel, palette, key bindings, Esc layers; sync, no I/O),
 * onStart (scene watches when Game is already active) and onStop (disposers, watches, timers).
 */
import type { GameViewCtx, GameViewState } from "./types";

/**
 * onInit: panels.register(createGamePanel(ctx)), palette items, keys and Esc layers.
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * createToolsPlugin("gameView", { onInit: initGameView });
 * ```
 */
export function initGameView(_ctx: GameViewCtx): void {
  throw new Error("not implemented");
}

/**
 * onStart: when Game is the active workspace (a restored #game hash emits no event), start the
 * scene watches.
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * createToolsPlugin("gameView", { onStart: startGameView });
 * ```
 */
export function startGameView(_ctx: GameViewCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: runs the disposers and every unwatch, clears timers, stops a running recording.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("gameView", { onStop: stopGameView });
 * ```
 */
export function stopGameView(_ctx: { readonly state: GameViewState }): void {
  throw new Error("not implemented");
}
