/**
 * @file gameView plugin — the key bindings and Esc closers gameView hands to the workspace keymap
 * (R4, design §4): ⇧⌘C and I toggle the picker (global, shows Game); \ collapses or expands the
 * Element panel in Game; M switches the game's sound in Game when the game has `game.mute` (round
 * 2b R11); ← → step and B marks a bug in Game while the contact sheet is open; Esc
 * layers contactSheet, seriesPopover, captureCard, picker (an area drag of Reference mode too),
 * each `false` when gameView has nothing open there.
 */
import { toggleSidePanel } from "../panels/shared/side-panel";
import type { EscLayer, KeyBinding } from "../workspace/types";
import { setPopover } from "./capture/series";
import { closeSheetLayer, stepSheet, toggleBug } from "./capture/sheet";
import { hideCard } from "./capture/shot";
import { setPicker } from "./element/select";
import { cancelArea } from "./reference/gesture";
import { SIDE_PANEL, SIDE_TITLE } from "./side";
import { canMute, setSound } from "./sound";
import type { GameViewCtx } from "./types";

/**
 * Toggles the picker from a key.
 *
 * @param ctx - Domain context of gameView.
 */
function togglePicker(ctx: GameViewCtx): void {
  setPicker(ctx);
}

/**
 * \: collapses or expands the Element panel (shows it when closed).
 */
function toggleSide(): void {
  toggleSidePanel(SIDE_PANEL);
}

/**
 * M: the Sound switch.
 *
 * @param ctx - Domain context of gameView.
 */
function toggleSound(ctx: GameViewCtx): void {
  void setSound(ctx);
}

/**
 * True while the contact sheet is open (the `when` of ← → B).
 *
 * @param ctx - Domain context of gameView.
 * @returns Whether a sheet is open.
 */
function sheetOpen(ctx: GameViewCtx): boolean {
  return ctx.state.series.sheet !== undefined;
}

/**
 * B: flips the bug mark of the shot in the large view (nothing on the grid).
 *
 * @param ctx - Domain context of gameView.
 */
function markShownShot(ctx: GameViewCtx): void {
  const big = ctx.state.series.sheet?.big;
  if (big !== undefined) toggleBug(ctx, big);
}

/**
 * Esc on the picker layer: cancels a Reference mode area drag (U9), else turns the picker off.
 *
 * @param ctx - Domain context of gameView.
 * @returns True when a drag was cancelled or the picker was on.
 */
function closePicker(ctx: GameViewCtx): boolean {
  if (cancelArea(ctx)) return true;
  if (!ctx.state.picker.on) return false;
  setPicker(ctx, false);
  return true;
}

/**
 * gameView's key bindings for `workspace.keys.bind`.
 *
 * @param ctx - Domain context of gameView.
 * @returns The six bindings.
 */
export function keyBindings(ctx: GameViewCtx): readonly KeyBinding[] {
  const whenSheet = sheetOpen.bind(undefined, ctx);
  return [
    { keys: ["mod+shift+c", "i"], label: "Select element", run: togglePicker.bind(undefined, ctx) },
    {
      keys: "\\",
      label: `Collapse or expand the ${SIDE_TITLE}`,
      workspace: "game",
      run: toggleSide
    },
    {
      keys: "m",
      label: "Sound on or off",
      workspace: "game",
      when: canMute.bind(undefined, ctx),
      run: toggleSound.bind(undefined, ctx)
    },
    {
      keys: "arrowleft",
      label: "Previous shot",
      workspace: "game",
      when: whenSheet,
      run: stepSheet.bind(undefined, ctx, -1)
    },
    {
      keys: "arrowright",
      label: "Next shot",
      workspace: "game",
      when: whenSheet,
      run: stepSheet.bind(undefined, ctx, 1)
    },
    {
      keys: "b",
      label: "Mark as bug",
      workspace: "game",
      when: whenSheet,
      run: markShownShot.bind(undefined, ctx)
    }
  ];
}

/**
 * gameView's Esc closers for `workspace.keys.escape`, in the workspace rank (design §4).
 *
 * @param ctx - Domain context of gameView.
 * @returns The four layers and their closers.
 */
export function escapeClosers(
  ctx: GameViewCtx
): readonly { readonly layer: EscLayer; readonly close: () => boolean }[] {
  return [
    { layer: "contactSheet", close: closeSheetLayer.bind(undefined, ctx) },
    { layer: "seriesPopover", close: setPopover.bind(undefined, ctx, false) },
    { layer: "captureCard", close: hideCard.bind(undefined, ctx) },
    { layer: "picker", close: closePicker.bind(undefined, ctx) }
  ];
}
