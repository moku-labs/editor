/**
 * @file gameView plugin — onInit (panel, palette, key bindings, Esc layers, device listener; sync,
 * no I/O), onStart (scene watches when Game is already active) and onStop (disposers, watches,
 * timers, a running recording).
 */
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import type { DeviceChoice } from "../workspace/types";
import { escapeClosers, keyBindings } from "./keys";
import { paletteItems } from "./palette";
import { recalibrate, startSceneWatches } from "./scene/watch";
import { notify } from "./state";
import type { GameViewCtx, GameViewState } from "./types";
import { createGamePanel } from "./ui/panel";

/**
 * The identity of a device choice.
 *
 * @param choice - Preset and orientation.
 * @returns "iphone-15:portrait".
 * @example
 * ```ts
 * deviceKey({ preset: DEVICES[1]!, orientation: "portrait" }); // "iphone-15:portrait"
 * ```
 */
function deviceKey(choice: DeviceChoice): string {
  return `${choice.preset.id}:${choice.orientation}`;
}

/**
 * Listens to workspace preferences: a device change re-calibrates the scene and re-renders the
 * overlay; theme and preview changes do nothing here.
 *
 * @param ctx - Domain context of gameView.
 * @returns Removes the listener.
 */
function watchDevice(ctx: GameViewCtx): () => void {
  const workspace = ctx.require(workspacePlugin);
  let last = deviceKey(workspace.device());
  return workspace.onPrefs(prefs => {
    const key = deviceKey(prefs.device);
    if (key === last) return;
    last = key;
    recalibrate(ctx);
    notify(ctx.state);
  });
}

/**
 * onInit: registers the Game panel, adds the palette items, binds the keys and the Esc layers and
 * listens to device changes. Every remover goes into `state.disposers`. Sync, no I/O.
 *
 * @param ctx - Domain context of gameView.
 */
export function initGameView(ctx: GameViewCtx): void {
  const { disposers } = ctx.state;
  const workspace = ctx.require(workspacePlugin);
  ctx.require(panelsPlugin).register(createGamePanel(ctx));
  disposers.push(workspace.palette.add(paletteItems(ctx)));
  for (const binding of keyBindings(ctx)) disposers.push(workspace.keys.bind(binding));
  for (const { layer, close } of escapeClosers(ctx)) {
    disposers.push(workspace.keys.escape(layer, close));
  }
  disposers.push(watchDevice(ctx));
}

/**
 * onStart: a restored `#game` hash emits no workspace:changed, so start the scene watches here
 * when Game is already the active workspace.
 *
 * @param ctx - Domain context of gameView.
 */
export function startGameView(ctx: GameViewCtx): void {
  if (ctx.require(workspacePlugin).active() === "game") startSceneWatches(ctx);
}

/**
 * onStop: runs the disposers (newest first) and every unwatch, clears the timers and stops a
 * running recording. Uses the teardown context only.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopGameView(ctx: { readonly state: GameViewState }): void {
  const { state } = ctx;
  for (const dispose of state.disposers.splice(0).toReversed()) dispose();
  for (const unwatch of state.watching.splice(0)) unwatch();
  for (const timer of Object.values(state.timers)) clearTimeout(timer);
  state.timers = {};
  if (state.series.recording !== undefined) state.series.recording.stopRequested = true;
}
