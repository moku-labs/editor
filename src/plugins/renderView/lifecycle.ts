/**
 * @file renderView plugin — onInit (register the Render panel), onStart (tracker watches for the
 * session, the manifest listeners of game.effects and Mission control, the device and theme
 * listeners, activeSource's telemetry, the active source; scene and Mission control watches when
 * Render is active) and onStop (every unwatch, Mission control's watches, poll, loop, detail read and
 * popovers, its listeners, the overlay root, the palette items).
 */
import { activeSourcePlugin } from "../activeSource";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { cancelDetail } from "./actions/detail";
import { closePopover } from "./actions/popover";
import { onWorkspaceChanged } from "./handlers";
import { removeOverlay } from "./overlay";
import { createRenderPanel } from "./panel";
import { addTelemetry } from "./series/telemetry";
import type { DeviceTelemetry } from "./source/contract";
import { restartMission, stopMission, timeOriginOf } from "./source/sync";
import { notifyMission } from "./state";
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
 * Takes a telemetry record of the active device: kept for the cards, placed on the source clock
 * when the clock offset and the page's origin are known (M2 rule 6).
 *
 * @param ctx - Domain context of renderView.
 * @param record - The record.
 */
function onTelemetry(ctx: RenderViewCtx, record: DeviceTelemetry): void {
  const { mission } = ctx.state;
  const offset = ctx.require(activeSourcePlugin).clockOffsetMs();
  mission.telemetry = record;
  addTelemetry(mission.series, record, offset, timeOriginOf(mission.second));
  notifyMission(mission);
}

/**
 * onStart: watches game.render and game.assets for the session and game.effects while the manifest
 * lists it, re-calibrates after a device change, re-renders Mission control after a theme change
 * (the canvases' palette), takes the active device's telemetry, restarts Mission control's reads
 * when the manifest changes, takes the active source, and starts the scene watches when Render is the
 * restored workspace (it emits no `workspace:changed`).
 *
 * @param ctx - Domain context of renderView.
 */
export function startRenderView(ctx: RenderViewCtx): void {
  const workspace = ctx.require(workspacePlugin);
  const activeSource = ctx.require(activeSourcePlugin);
  const { mission } = ctx.state;
  let device: string | undefined;
  let theme = workspace.theme();

  mission.source = activeSource.current();
  startTracker(ctx, () => restartMission(ctx));
  ctx.state.tracker.push(
    workspace.onPrefs(prefs => {
      if (prefs.theme !== theme) {
        theme = prefs.theme;
        notifyMission(mission);
      }
      const next = `${prefs.device.preset.id}/${prefs.device.orientation}`;
      if (next === device) return;
      device = next;
      recalibrate(ctx);
    }),
    activeSource.onTelemetry(record => onTelemetry(ctx, record))
  );
  if (workspace.active() === "render") onWorkspaceChanged(ctx)({ ws: "render" });
}

/**
 * onStop: every unwatch of the tracker and the scene, the manifest, device, theme and telemetry
 * listeners, the game.effects watch, Mission control's watches, poll, loop, detail read and popovers
 * (the Connect panel's scan lease ends), its listeners, the overlay root and the Textures palette
 * items. Teardown context only (spec/08 §4).
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopRenderView(ctx: { readonly state: RenderViewState }): void {
  const { state } = ctx;
  const { mission } = state;
  const stops = [...state.tracker, ...state.watching];

  state.tracker = [];
  state.watching = [];
  state.sources = {};
  for (const stop of stops) stop();
  stopEffects(state);
  stopMission(state);
  mission.stopLoop?.();
  mission.stopLoop = undefined;
  cancelDetail(mission);
  closePopover(mission);
  mission.listeners.clear();
  removeOverlay(state);
  state.palette?.();
  state.palette = undefined;
  state.listeners.clear();
}
