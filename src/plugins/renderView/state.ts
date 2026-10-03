/**
 * @file renderView plugin — state factory and the UI store (notify, subscribe).
 */
import type { RenderViewConfig, RenderViewState } from "./types";

/**
 * Creates the initial renderView state: sort gpuMb descending, bundle "all", root open.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createRenderViewState({ config }).table.sort; // "gpuMb"
 * ```
 */
export function createRenderViewState(_ctx: {
  readonly config: Readonly<RenderViewConfig>;
}): RenderViewState {
  throw new Error("not implemented");
}

/**
 * Calls every UI listener.
 *
 * @param _state - renderView state.
 * @example
 * ```ts
 * notify(ctx.state);
 * ```
 */
export function notify(_state: RenderViewState): void {
  throw new Error("not implemented");
}

/**
 * Adds a UI listener; returns an idempotent remover.
 *
 * @param _state - renderView state.
 * @param _fn - The listener.
 * @example
 * ```ts
 * const off = subscribe(ctx.state, rerender);
 * ```
 */
export function subscribe(_state: RenderViewState, _fn: () => void): () => void {
  throw new Error("not implemented");
}
