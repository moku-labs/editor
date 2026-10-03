/**
 * @file gameView plugin — the palette items gameView adds in onInit: Select element, Take a
 * screenshot, Record a series…, Overlay in game and the six device presets (group Commands).
 */
import { linkPlugin } from "../link";
import type { DeviceSpec } from "../registry/protocol";
import { workspacePlugin } from "../workspace";
import { isDevicePresetId } from "../workspace/devices";
import type { PaletteItem } from "../workspace/types";
import { setPopover } from "./capture/series";
import { takeScreenshot } from "./capture/shot";
import {
  GAME_COMMANDS,
  hasCommand,
  NO_CAPTURE_TEXT,
  NO_OVERLAY_TEXT,
  OVERLAY_COMMAND
} from "./commands";
import { setPicker } from "./element/select";
import type { GameViewCtx } from "./types";

/**
 * The reason a command item is dimmed: a connected game that lacks the command.
 *
 * @param ctx - Domain context of gameView.
 * @param id - The command id.
 * @param reason - The tooltip text.
 * @returns The reason, or false.
 */
export function missingCommand(ctx: GameViewCtx, id: string, reason: string): string | false {
  const manifest = ctx.require(linkPlugin).manifest();
  return manifest === undefined || hasCommand(manifest, id) ? false : reason;
}

/**
 * Takes a screenshot from the palette.
 *
 * @param ctx - Domain context of gameView.
 * @returns Resolves when saved or toasted.
 */
async function captureNow(ctx: GameViewCtx): Promise<void> {
  await takeScreenshot(ctx);
}

/**
 * Shows Game and opens the series popover.
 *
 * @param ctx - Domain context of gameView.
 */
export function openSeries(ctx: GameViewCtx): void {
  ctx.require(workspacePlugin).show("game");
  setPopover(ctx, true);
}

/**
 * Flips the overlay-in-game switch (workspace owns the flag and runs editor.overlay, R4).
 *
 * @param ctx - Domain context of gameView.
 * @returns Resolves when workspace settled the run.
 */
export async function toggleOverlay(ctx: GameViewCtx): Promise<void> {
  const workspace = ctx.require(workspacePlugin);
  await workspace.setOverlayInGame(!workspace.overlayInGame());
}

/**
 * Chooses a device preset in its natural orientation.
 *
 * @param ctx - Domain context of gameView.
 * @param id - The preset id.
 */
export function chooseDevice(ctx: GameViewCtx, id: string): void {
  if (!isDevicePresetId(id)) return;
  ctx.require(workspacePlugin).setDevice({ preset: id, orientation: "portrait" });
}

/**
 * The palette item of one device preset.
 *
 * @param ctx - Domain context of gameView.
 * @param device - The preset.
 * @returns The item.
 */
function deviceItem(ctx: GameViewCtx, device: DeviceSpec): PaletteItem {
  return {
    id: `game:device:${device.id}`,
    group: "Commands",
    label: `Device: ${device.name}`,
    hint: `${device.w}×${device.h}`,
    keywords: "device preset size",
    run: chooseDevice.bind(undefined, ctx, device.id)
  };
}

/**
 * gameView's palette items.
 *
 * @param ctx - Domain context of gameView.
 * @returns The ten items.
 */
export function paletteItems(ctx: GameViewCtx): readonly PaletteItem[] {
  return [
    {
      id: "game:pick",
      group: "Commands",
      label: "Select element",
      shortcut: "⇧⌘C",
      keywords: "picker inspect element",
      run: setPicker.bind(undefined, ctx, true)
    },
    {
      id: "game:capture",
      group: "Commands",
      label: "Take a screenshot",
      keywords: "capture camera png",
      run: captureNow.bind(undefined, ctx),
      disabled: missingCommand.bind(undefined, ctx, GAME_COMMANDS.capture, NO_CAPTURE_TEXT)
    },
    {
      id: "game:series",
      group: "Commands",
      label: "Record a series…",
      keywords: "capture series frames record",
      run: openSeries.bind(undefined, ctx),
      disabled: missingCommand.bind(undefined, ctx, GAME_COMMANDS.series, NO_CAPTURE_TEXT)
    },
    {
      id: "game:overlay",
      group: "Commands",
      label: "Overlay in game",
      keywords: "overlay render cheats",
      run: toggleOverlay.bind(undefined, ctx),
      disabled: missingCommand.bind(undefined, ctx, OVERLAY_COMMAND, NO_OVERLAY_TEXT)
    },
    ...ctx
      .require(workspacePlugin)
      .devices()
      .map(device => deviceItem(ctx, device))
  ];
}
