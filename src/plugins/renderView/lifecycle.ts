/**
 * @file renderView plugin — onInit (register the Render panel), onStart (tracker watches for the
 * session; scene watches when Render is active) and onStop (every unwatch, the overlay root).
 */
import type { RenderViewCtx, RenderViewState } from "./types";

/**
 * onInit: panels.register(createRenderPanel(ctx)). Sync.
 *
 * @param _ctx - Domain context of renderView.
 * @example
 * ```ts
 * createToolsPlugin("renderView", { onInit: initRenderView });
 * ```
 */
export function initRenderView(_ctx: RenderViewCtx): void {
  throw new Error("not implemented");
}

/**
 * onStart: watches game.render and game.assets for the session; scene watches when Render is active.
 *
 * @param _ctx - Domain context of renderView.
 * @example
 * ```ts
 * createToolsPlugin("renderView", { onStart: startRenderView });
 * ```
 */
export function startRenderView(_ctx: RenderViewCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: every unwatch of the tracker and the scene; removes the overlay root.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("renderView", { onStop: stopRenderView });
 * ```
 */
export function stopRenderView(_ctx: { readonly state: RenderViewState }): void {
  throw new Error("not implemented");
}
