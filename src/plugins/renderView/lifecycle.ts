/**
 * @file renderView plugin — onInit (register the Render panel), onStart (tracker watches for the
 * session, the manifest listener of game.effects and the D1 strip, the device listener, the
 * computer's engine listener, scene watches when Render is active) and onStop (every unwatch, the
 * strip's watches and repaint timers, the overlay root, the palette items).
 */
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { notifyStrip } from "./device/state";
import { stopDeviceWatches } from "./device/watch";
import { onWorkspaceChanged } from "./handlers";
import { removeOverlay } from "./overlay";
import { createRenderPanel } from "./panel";
import type { RenderViewCtx, RenderViewState } from "./types";
import { recalibrate, startTracker, stopEffects } from "./watch";

/**
 * onInit: registers the Render panel. Sync (spec/06 §2).
 *
 * @param ctx - Domain context of renderView.
 */
export function initRenderView(ctx: RenderViewCtx): void {
  ctx.require(panelsPlugin).register(createRenderPanel(ctx));
}

/**
 * onStart: watches game.render and game.assets for the session and game.effects while the
 * manifest lists it, re-calibrates after a device change, re-renders the strip's STALE cell when
 * the computer's engine fingerprint arrives, and starts the scene watches when Render is the
 * restored workspace (it emits no `workspace:changed`).
 *
 * @param ctx - Domain context of renderView.
 */
export function startRenderView(ctx: RenderViewCtx): void {
  const workspace = ctx.require(workspacePlugin);
  let device: string | undefined;

  startTracker(ctx);
  ctx.state.tracker.push(
    ctx.require(linkPlugin).onEngine(() => {
      notifyStrip(ctx.state.device);
    }),
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
 * onStop: every unwatch of the tracker and the scene, the manifest, device and engine listeners,
 * the game.effects watch, the strip's device watches and the timers of its repaint loop (a late
 * record answer is dropped), the overlay root and the Textures palette items. Teardown context
 * only (spec/08 §4).
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopRenderView(ctx: { readonly state: RenderViewState }): void {
  const { state } = ctx;
  const stops = [...state.tracker, ...state.watching];

  state.tracker = [];
  state.watching = [];
  state.sources = {};
  for (const stop of stops) stop();
  stopEffects(state);
  stopDeviceWatches(state);
  state.device.stopPaint?.();
  state.device.reading = undefined;
  state.device.listeners.clear();
  removeOverlay(state);
  state.palette?.();
  state.palette = undefined;
  state.listeners.clear();
}
