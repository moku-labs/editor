/**
 * @file gameView plugin — the key bindings and Esc closers gameView hands to the workspace keymap
 * (R4, design §4): ⇧⌘C and I toggle the picker (global, shows Game); ← → step and B marks a bug
 * in Game while the contact sheet is open; Esc layers contactSheet, seriesPopover, captureCard,
 * picker, each `false` when gameView has nothing open there.
 */
import type { EscLayer, KeyBinding } from "../workspace/types";
import { setPopover } from "./capture/series";
import { closeSheetLayer, stepSheet, toggleBug } from "./capture/sheet";
import { hideCard } from "./capture/shot";
import { setPicker } from "./element/select";
import type { GameViewCtx } from "./types";

/**
 * Toggles the picker from a key.
 *
 * @param ctx - Domain context of gameView.
 * @example
 * ```ts
 * togglePicker(ctx); // picker on, Game shown
 * ```
 */
function togglePicker(ctx: GameViewCtx): void {
  setPicker(ctx);
}

/**
 * True while the contact sheet is open (the `when` of ← → B).
 *
 * @param ctx - Domain context of gameView.
 * @returns Whether a sheet is open.
 * @example
 * ```ts
 * sheetOpen(ctx); // false
 * ```
 */
function sheetOpen(ctx: GameViewCtx): boolean {
  return ctx.state.series.sheet !== undefined;
}

/**
 * B: flips the bug mark of the shot in the large view (nothing on the grid).
 *
 * @param ctx - Domain context of gameView.
 * @example
 * ```ts
 * markShownShot(ctx); // shot 4 marked as bug
 * ```
 */
function markShownShot(ctx: GameViewCtx): void {
  const big = ctx.state.series.sheet?.big;
  if (big !== undefined) toggleBug(ctx, big);
}

/**
 * Esc on the picker layer: turns the picker off.
 *
 * @param ctx - Domain context of gameView.
 * @returns True when the picker was on.
 * @example
 * ```ts
 * closePicker(ctx); // false when the picker is off
 * ```
 */
function closePicker(ctx: GameViewCtx): boolean {
  if (!ctx.state.picker.on) return false;
  setPicker(ctx, false);
  return true;
}

/**
 * gameView's key bindings for `workspace.keys.bind`.
 *
 * @param ctx - Domain context of gameView.
 * @returns The four bindings.
 * @example
 * ```ts
 * for (const binding of keyBindings(ctx)) ctx.state.disposers.push(workspace.keys.bind(binding));
 * ```
 */
export function keyBindings(ctx: GameViewCtx): readonly KeyBinding[] {
  const whenSheet = sheetOpen.bind(undefined, ctx);
  return [
    { keys: ["mod+shift+c", "i"], label: "Select element", run: togglePicker.bind(undefined, ctx) },
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
 * @example
 * ```ts
 * for (const { layer, close } of escapeClosers(ctx)) workspace.keys.escape(layer, close);
 * ```
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
