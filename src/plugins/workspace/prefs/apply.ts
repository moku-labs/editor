/**
 * @file workspace plugin — preference changes (theme, preview per workspace, device and fold,
 * density, Show taps, sound): apply to the state, persist to localStorage, tell the `onPrefs`
 * listeners (theme, preview, device and sound only), re-render and re-dock the frame. Visibility
 * changes of a preview toast the workspace name.
 */
import { WORKSPACE_LABELS } from "../../panels/shared/workspaces";
import { DEVICES, ERROR_PREFIX, isDevicePresetId } from "../../registry/protocol";
import { deviceChoiceOf } from "../devices";
import { PREVIEW_SIZES } from "../frame/dock";
import { syncFrame } from "../frame/frame";
import { clearTaps } from "../frame/taps";
import { showToast } from "../toasts";
import type {
  DensityChoice,
  DevicePresetId,
  Orientation,
  Prefs,
  PreviewPrefs,
  PreviewState,
  PreviewWorkspace,
  Theme,
  WorkspaceCtx,
  WorkspaceState
} from "../types";
import { isDensityChoice, refreshDensity } from "./density";
import { savePrefs } from "./store";
import { applyTheme, effectiveTheme } from "./theme";

/**
 * The part of the workspace ctx preference changes need.
 */
export type PrefsCtx = Pick<WorkspaceCtx, "state" | "config" | "log">;

/**
 * The preferences `onPrefs` listeners receive.
 *
 * @param state - Workspace state.
 * @returns Effective theme, a copy of the previews, the device choice (the screen in use) and
 * the sound flag.
 */
export function currentPrefs(state: WorkspaceState): Prefs {
  return {
    theme: effectiveTheme(state.theme),
    previews: structuredClone(state.previews),
    device: deviceChoiceOf(state.device),
    muted: state.muted
  };
}

/**
 * Writes the preferences record of the state to localStorage.
 *
 * @param ctx - State, config and log.
 */
export function persistPrefs(ctx: PrefsCtx): void {
  const { state } = ctx;
  savePrefs(
    ctx.config.storageKey,
    {
      theme: state.theme.chosen,
      previews: state.previews,
      device: state.device,
      density: state.density.chosen,
      showTaps: state.showTaps,
      muted: state.muted
    },
    ctx.log
  );
}

/**
 * Persists the preferences, calls every listener (one that throws is logged), re-renders and
 * re-docks the frame.
 *
 * @param ctx - State, config and log.
 */
export function commitPrefs(ctx: PrefsCtx): void {
  const { state } = ctx;
  persistPrefs(ctx);

  const prefs = currentPrefs(state);
  for (const listener of state.listeners) {
    try {
      listener(prefs);
    } catch (error) {
      ctx.log.error(
        "workspace:prefs-listener-failed",
        {},
        error instanceof Error ? error : undefined
      );
    }
  }
  state.ui.bump();
  syncFrame(ctx);
}

/**
 * Shows the effective theme on `<html>` (where there is a document).
 *
 * @param state - Workspace state.
 */
export function showTheme(state: WorkspaceState): void {
  const root = globalThis.document?.documentElement;
  if (root !== undefined) applyTheme(effectiveTheme(state.theme), root);
}

/**
 * Sets the theme, or toggles the effective one when omitted; the choice persists.
 *
 * @param ctx - State, config and log.
 * @param theme - The theme, undefined to toggle.
 */
export function chooseTheme(ctx: PrefsCtx, theme?: Theme): void {
  const { state } = ctx;
  state.theme.chosen = theme ?? (effectiveTheme(state.theme) === "dark" ? "light" : "dark");
  showTheme(state);
  commitPrefs(ctx);
}

/**
 * Chooses the density and persists it; a changed applied value shows on `<html>` and emits
 * `workspace:density`.
 *
 * @param ctx - State, config, log and emit.
 * @param choice - auto, compact or comfortable.
 * @throws {Error} `[moku-editor] Unknown density "<value>".` for another value.
 */
export function chooseDensity(
  ctx: PrefsCtx & Pick<WorkspaceCtx, "emit">,
  choice: DensityChoice
): void {
  if (!isDensityChoice(choice)) {
    throw new Error(
      `${ERROR_PREFIX}Unknown density "${String(choice)}".\n  Use auto, compact or comfortable.`
    );
  }
  ctx.state.density.chosen = choice;
  persistPrefs(ctx);
  refreshDensity(ctx);
  ctx.state.ui.bump();
}

/**
 * Turns the tap ripples on or off and persists the choice; off removes the ripples alive.
 *
 * @param ctx - State, config and log.
 * @param on - Whether taps draw a ripple.
 */
export function chooseShowTaps(ctx: PrefsCtx, on: boolean): void {
  ctx.state.showTaps = on;
  if (!on) clearTaps(ctx.state);
  persistPrefs(ctx);
  ctx.state.ui.bump();
}

/**
 * Sets the sound flag (R11): persists it and tells the `onPrefs` listeners. The same value again
 * does nothing.
 *
 * @param ctx - State, config and log.
 * @param on - True to mute the game.
 */
export function chooseMuted(ctx: PrefsCtx, on: boolean): void {
  if (ctx.state.muted === on) return;

  ctx.state.muted = on;
  commitPrefs(ctx);
}

/**
 * Follows an OS theme change (visible only while no theme is chosen).
 *
 * @param ctx - State, config and log.
 * @param theme - The new OS theme.
 */
export function osThemeChanged(ctx: PrefsCtx, theme: Theme): void {
  ctx.state.theme.os = theme;
  showTheme(ctx.state);
  commitPrefs(ctx);
}

/**
 * Preview state of a workspace: its prefs plus the float size in px.
 *
 * @param state - Workspace state.
 * @param ws - A workspace with a preview.
 * @returns A copy.
 */
export function previewState(state: WorkspaceState, ws: PreviewWorkspace): PreviewState {
  const prefs = state.previews[ws];
  const size = PREVIEW_SIZES[prefs.size];
  return { ...prefs, width: size.w, height: size.h };
}

/**
 * Patches the preview prefs of a workspace; a visibility change toasts
 * "Game preview hidden in Flow · remembered for this workspace".
 *
 * @param ctx - State, config and log.
 * @param ws - A workspace with a preview.
 * @param patch - Fields to change.
 */
export function patchPreview(
  ctx: PrefsCtx,
  ws: PreviewWorkspace,
  patch: Partial<PreviewPrefs>
): void {
  const { state } = ctx;
  const before = state.previews[ws];
  const next: PreviewPrefs = { ...before, ...patch };
  state.previews[ws] = next;

  if (next.visible !== before.visible) {
    const verb = next.visible ? "shown" : "hidden";
    showToast(
      ctx,
      `Game preview ${verb} in ${WORKSPACE_LABELS[ws]} · remembered for this workspace`
    );
  }
  commitPrefs(ctx);
}

/**
 * Changes the device preset, orientation and/or fold; the frame box resizes (a real window resize
 * in the game page, no reload). A new preset starts folded (the flag is dropped) unless the patch
 * sets `folded`.
 *
 * @param ctx - State, config and log.
 * @param patch - The preset, orientation and/or fold.
 * @param patch.preset - A preset id.
 * @param patch.orientation - portrait or landscape.
 * @param patch.folded - true for a foldable's cover screen, false for its inner one.
 * @throws {Error} `[moku-editor] Unknown device "<id>".` for an unknown preset.
 */
export function patchDevice(
  ctx: PrefsCtx,
  patch: {
    readonly preset?: DevicePresetId;
    readonly orientation?: Orientation;
    readonly folded?: boolean;
  }
): void {
  const { device } = ctx.state;
  if (patch.preset !== undefined && !isDevicePresetId(patch.preset)) {
    const ids = DEVICES.map(entry => entry.id).join(", ");
    throw new Error(
      `${ERROR_PREFIX}Unknown device "${String(patch.preset)}".\n  Use one of ${ids}.`
    );
  }
  if (patch.preset !== undefined && patch.preset !== device.preset) {
    device.preset = patch.preset;
    delete device.folded;
  }
  if (patch.orientation !== undefined) device.orientation = patch.orientation;
  if (patch.folded !== undefined) device.folded = patch.folded;
  commitPrefs(ctx);
}

/**
 * Adds an `onPrefs` listener.
 *
 * @param state - Workspace state.
 * @param fn - Called after every preference change.
 * @returns Removes it.
 */
export function addPrefsListener(state: WorkspaceState, fn: (prefs: Prefs) => void): () => void {
  /**
   * A wrapper, so the same function added twice gets two entries.
   *
   * @param prefs - The preferences.
   */
  const listener = (prefs: Prefs): void => {
    fn(prefs);
  };
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}
