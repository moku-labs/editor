/**
 * @file renderView plugin — onInit (register the Render panel), onStart (tracker watches for the
 * session, the device listener, scene watches when Render is active) and onStop (every unwatch,
 * the overlay root, the palette items).
 */
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { onWorkspaceChanged } from "./handlers";
import { removeOverlay } from "./overlay";
import { createRenderPanel } from "./panel";
import type { RenderViewCtx, RenderViewState } from "./types";
import { recalibrate, startTracker } from "./watch";

/**
 * onInit: registers the Render panel. Sync (spec/06 §2).
 *
 * @param ctx - Domain context of renderView.
 * @example
 * ```ts
 * createToolsPlugin("renderView", { onInit: initRenderView }); // app.panels.list() has "render"
 * ```
 */
export function initRenderView(ctx: RenderViewCtx): void {
  ctx.require(panelsPlugin).register(createRenderPanel(ctx));
}

/**
 * onStart: watches game.render and game.assets for the session, re-calibrates after a device
 * change, and starts the scene watches when Render is the restored workspace (it emits no
 * `workspace:changed`).
 *
 * @param ctx - Domain context of renderView.
 * @example
 * ```ts
 * createToolsPlugin("renderView", { onStart: startRenderView }); // link watches game.render, game.assets
 * ```
 */
export function startRenderView(ctx: RenderViewCtx): void {
  const workspace = ctx.require(workspacePlugin);
  let device: string | undefined;

  startTracker(ctx);
  ctx.state.tracker.push(
    workspace.onPrefs(prefs => {
      const next = `${prefs.device.preset.id}/${prefs.device.orientation}`;
      if (next === device) return;
      device = next;
      recalibrate(ctx);
    })
  );
  if (workspace.active() === "render") onWorkspaceChanged(ctx)({ ws: "render" });
}

/**
 * onStop: every unwatch of the tracker and the scene, the device listener, the overlay root and
 * the Textures palette items. Teardown context only (spec/08 §4).
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("renderView", { onStop: stopRenderView }); // no watch left after app.stop()
 * ```
 */
export function stopRenderView(ctx: { readonly state: RenderViewState }): void {
  const { state } = ctx;
  const stops = [...state.tracker, ...state.watching];

  state.tracker = [];
  state.watching = [];
  state.sources = {};
  for (const stop of stops) stop();
  removeOverlay(state);
  state.palette?.();
  state.palette = undefined;
  state.listeners.clear();
}
