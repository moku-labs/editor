/**
 * @file gameView plugin — state factory and the UI store (notify, subscribe).
 */
import type { GameViewConfig, GameViewState } from "./types";

/**
 * Creates the initial gameView state: Element tab, fit, safe area on, picker off, nothing read.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createGameViewState({ config }).tab; // "element"
 * ```
 */
export function createGameViewState(_ctx: {
  readonly config: Readonly<GameViewConfig>;
}): GameViewState {
  throw new Error("not implemented");
}

/**
 * Calls every UI listener.
 *
 * @param _state - gameView state.
 * @example
 * ```ts
 * notify(ctx.state);
 * ```
 */
export function notify(_state: GameViewState): void {
  throw new Error("not implemented");
}

/**
 * Adds a UI listener; returns an idempotent remover.
 *
 * @param _state - gameView state.
 * @param _fn - The listener.
 * @example
 * ```ts
 * const off = subscribe(ctx.state, rerender);
 * ```
 */
export function subscribe(_state: GameViewState, _fn: () => void): () => void {
  throw new Error("not implemented");
}
