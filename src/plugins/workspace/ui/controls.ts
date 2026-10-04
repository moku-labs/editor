/**
 * @file workspace plugin — what the top-bar toggles show and do, read once per render and shared
 * by the wide bar (switches and buttons, 900 px and wider) and the ⋯ menu rows below 900 px:
 * Game preview (G), Overlay in game (O), Reference mode (R), Hot reload (H), and the registry
 * counts.
 */
import { linkPlugin } from "../../link";
import type { Manifest } from "../../registry/protocol";
import { togglePreview } from "../actions";
import { canSwitchHotReload, hotReloadTitle, toggleHotReload } from "../hot-reload";
import { overlayAvailable, setOverlayInGame } from "../overlay";
import { toggleReference } from "../reference";
import type { WorkspaceCtx } from "../types";
import { isPreviewWorkspace } from "../workspaces";

/**
 * One toggle of the top bar.
 */
export type ToggleControl = {
  /** `data-action` of the switch and of the menu row. */
  readonly name: string;
  /** The ⋯ menu label. */
  readonly label: string;
  /** The switch label in the wide bar. */
  readonly short: string;
  /** The key that flips it. */
  readonly key: string;
  readonly checked: boolean;
  /** The state in words for the menu row: on, off, or unknown. */
  readonly state: string;
  readonly disabled: boolean;
  readonly title: string;
  readonly toggle: () => void;
};

/**
 * on or off.
 *
 * @param on - A flag.
 * @returns The word.
 * @example
 * ```ts
 * onOff(true); // "on"
 * ```
 */
function onOff(on: boolean): string {
  return on ? "on" : "off";
}

/**
 * The Game preview toggle (G): inert in Game, which always shows the game.
 *
 * @param ctx - Domain context of workspace.
 * @returns The control.
 */
export function previewControl(ctx: WorkspaceCtx): ToggleControl {
  const { active, previews } = ctx.state;
  const inGame = !isPreviewWorkspace(active);
  const checked = inGame || previews[active].visible;
  return {
    name: "game",
    label: "Game preview",
    short: "Preview",
    key: "G",
    checked,
    state: onOff(checked),
    disabled: inGame,
    title: inGame ? "The Game workspace always shows the game" : "Game preview (G)",
    toggle: () => togglePreview(ctx)
  };
}

/**
 * The Overlay in game toggle (O): inert until a connected game lists `editor.overlay`.
 *
 * @param ctx - Domain context of workspace.
 * @returns The control.
 */
export function overlayControl(ctx: WorkspaceCtx): ToggleControl {
  const { state } = ctx;
  const ready = overlayAvailable(ctx);
  return {
    name: "overlay",
    label: "Overlay in game",
    short: "Overlay",
    key: "O",
    checked: state.overlayInGame,
    state: onOff(state.overlayInGame),
    disabled: !ready,
    title: ready ? "Overlay in game (O)" : "Connect a game with editor.overlay first",
    toggle: () => {
      void setOverlayInGame(ctx, !state.overlayInGame, "topbar");
    }
  };
}

/**
 * The Reference mode toggle (R).
 *
 * @param ctx - Domain context of workspace.
 * @returns The control.
 */
export function referenceControl(ctx: WorkspaceCtx): ToggleControl {
  const { reference } = ctx.state;
  return {
    name: "reference",
    label: "Reference mode",
    short: "Reference",
    key: "R",
    checked: reference,
    state: onOff(reference),
    disabled: false,
    title: "Reference mode (R) — pick game elements for the chat",
    toggle: () => toggleReference(ctx)
  };
}

/**
 * The Hot reload toggle (H): link's state; only the bin owns it.
 *
 * @param ctx - Domain context of workspace.
 * @returns The control.
 */
export function hotReloadControl(ctx: WorkspaceCtx): ToggleControl {
  const current = ctx.require(linkPlugin).hotReload();
  return {
    name: "hot-reload",
    label: "Hot reload",
    short: "Hot reload",
    key: "H",
    checked: current?.hmr === true,
    state: current === undefined ? "unknown" : onOff(current.hmr),
    disabled: !canSwitchHotReload(current),
    title: hotReloadTitle(current, ctx.state.hotReloadNote),
    toggle: () => toggleHotReload(ctx)
  };
}

/**
 * A count with its noun, plural from 2 (and for 0).
 *
 * @param count - The count.
 * @param noun - The singular noun.
 * @returns E.g. "1 source", "4 commands".
 * @example
 * ```ts
 * counted(4, "command"); // "4 commands"
 * ```
 */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The tooltip of the Registry control.
 *
 * @param manifest - The manifest of the followed session.
 * @returns E.g. "Registry · 12 sources · 30 commands".
 * @example
 * ```ts
 * registryTitle(undefined); // "Registry · no game connected"
 * ```
 */
export function registryTitle(manifest: Manifest | undefined): string {
  if (manifest === undefined) return "Registry · no game connected";
  return `Registry · ${counted(manifest.sources.length, "source")} · ${counted(manifest.commands.length, "command")}`;
}

/**
 * The registry counts of the ⋯ menu row: sources · commands.
 *
 * @param manifest - The manifest of the followed session.
 * @returns E.g. "12 · 30", "– · –" without a game.
 * @example
 * ```ts
 * registryCounts(undefined); // "– · –"
 * ```
 */
export function registryCounts(manifest: Manifest | undefined): string {
  return manifest === undefined
    ? "– · –"
    : `${manifest.sources.length} · ${manifest.commands.length}`;
}
