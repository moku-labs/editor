/**
 * @file gameView plugin — onInit (the capturesDir check, panel, palette, key bindings, Esc layers,
 * device listener; sync, no I/O), onStart (scene watches when Game is already active, Reference
 * mode when already on, the sound flag applied to every game that connects) and onStop
 * (disposers, watches, the game.position watch, timers, a running recording).
 */
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import type { DeviceChoice } from "../workspace/types";
import { escapeClosers, keyBindings } from "./keys";
import { paletteItems } from "./palette";
import { dropReference, setReferenceMode } from "./reference/mode";
import { recalibrate } from "./scene/calibrate";
import { startSceneWatches } from "./scene/watch";
import { reapplyMute } from "./sound";
import { notify } from "./state";
import type { GameViewCtx, GameViewState } from "./types";
import { createGamePanel } from "./ui/panel";

/**
 * The identity of a device choice: preset, orientation and, for a foldable, the screen shown.
 *
 * @param choice - Preset, orientation and the folded flag.
 * @returns "iphone-15:portrait:folded".
 * @example
 * ```ts
 * deviceKey({ preset: presetOf("galaxy-z-fold-6"), orientation: "portrait", folded: false }); // "galaxy-z-fold-6:portrait:unfolded"
 * ```
 */
function deviceKey(choice: DeviceChoice): string {
  return `${choice.preset.id}:${choice.orientation}:${choice.folded ? "folded" : "unfolded"}`;
}

/**
 * The folder captures go to: `.moku/captures` or a folder under it (the files sandbox allows
 * writes there).
 */
const CAPTURES_ROOT = ".moku/captures";

/**
 * Refuses a `capturesDir` outside `.moku/captures` (round 2 breaking change).
 *
 * @param dir - The configured folder.
 * @throws {Error} `[moku-editor] gameView.capturesDir must be .moku/captures or a folder under it.`
 */
function checkCapturesDir(dir: string): void {
  if (dir === CAPTURES_ROOT || dir.startsWith(`${CAPTURES_ROOT}/`)) return;
  throw new Error(
    '[moku-editor] gameView.capturesDir must be .moku/captures or a folder under it.\n  Set pluginConfigs.gameView.capturesDir to ".moku/captures/<sub>".'
  );
}

/**
 * Listens to workspace preferences: a device change (a fold too) re-calibrates the scene (after
 * the next ui snapshot while watching) and re-renders the overlay; theme and preview changes do
 * nothing here.
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
 * onInit: checks `capturesDir`, registers the Game panel, adds the palette items, binds the keys
 * and the Esc layers and listens to device changes. Every remover goes into `state.disposers`.
 * Sync, no I/O.
 *
 * @param ctx - Domain context of gameView.
 * @throws {Error} When `capturesDir` is not `.moku/captures` or a folder under it.
 */
export function initGameView(ctx: GameViewCtx): void {
  checkCapturesDir(ctx.config.capturesDir);
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
 * when Game is already the active workspace; likewise Reference mode when workspace has it on.
 * Every game that connects (a hot reload too) is muted again while the viewer has the sound off.
 *
 * @param ctx - Domain context of gameView.
 */
export function startGameView(ctx: GameViewCtx): void {
  const workspace = ctx.require(workspacePlugin);
  if (workspace.active() === "game") startSceneWatches(ctx);
  if (workspace.reference()) setReferenceMode(ctx, true);
  const link = ctx.require(linkPlugin);
  ctx.state.disposers.push(link.onManifest(manifest => reapplyMute(ctx, manifest)));
}

/**
 * onStop: runs the disposers (newest first), every unwatch and the game.position watch of
 * Reference mode, clears the timers and stops a running recording. Uses the teardown context
 * only.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopGameView(ctx: { readonly state: GameViewState }): void {
  const { state } = ctx;
  for (const dispose of state.disposers.splice(0).toReversed()) dispose();
  for (const unwatch of state.watching.splice(0)) unwatch();
  dropReference(state);
  for (const timer of Object.values(state.timers)) clearTimeout(timer);
  state.timers = {};
  if (state.series.recording !== undefined) state.series.recording.stopRequested = true;
}
