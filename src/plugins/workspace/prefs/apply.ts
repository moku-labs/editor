/**
 * @file workspace plugin — preference changes (theme, preview per workspace, device): apply to
 * the state, persist to localStorage, tell the `onPrefs` listeners, re-render and re-dock the
 * frame. Visibility changes of a preview toast the workspace name.
 */
import { ERROR_PREFIX } from "../../registry/protocol";
import { DEVICES, isDevicePresetId, presetOf } from "../devices";
import { PREVIEW_SIZES } from "../frame/dock";
import { syncFrame } from "../frame/frame";
import { showToast } from "../toasts";
import type {
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
import { WORKSPACE_LABELS } from "../workspaces";
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
 * @returns Effective theme, a copy of the previews, the device choice.
 */
export function currentPrefs(state: WorkspaceState): Prefs {
  return {
    theme: effectiveTheme(state.theme),
    previews: structuredClone(state.previews),
    device: { preset: presetOf(state.device.preset), orientation: state.device.orientation }
  };
}

/**
 * Persists the preferences, calls every listener (one that throws is logged), re-renders and
 * re-docks the frame.
 *
 * @param ctx - State, config and log.
 */
export function commitPrefs(ctx: PrefsCtx): void {
  const { state } = ctx;
  savePrefs(
    ctx.config.storageKey,
    { theme: state.theme.chosen, previews: state.previews, device: state.device },
    ctx.log
  );

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
 * Changes the device preset and/or orientation; the frame box resizes (a real window resize in
 * the game page).
 *
 * @param ctx - State, config and log.
 * @param patch - The preset and/or orientation.
 * @param patch.preset - A preset id.
 * @param patch.orientation - portrait or landscape.
 * @throws {Error} `[moku-editor] Unknown device "<id>".` for an unknown preset.
 */
export function patchDevice(
  ctx: PrefsCtx,
  patch: { readonly preset?: DevicePresetId; readonly orientation?: Orientation }
): void {
  const { device } = ctx.state;
  if (patch.preset !== undefined && !isDevicePresetId(patch.preset)) {
    const ids = DEVICES.map(entry => entry.id).join(", ");
    throw new Error(
      `${ERROR_PREFIX}Unknown device "${String(patch.preset)}".\n  Use one of ${ids}.`
    );
  }
  if (patch.preset !== undefined) device.preset = patch.preset;
  if (patch.orientation !== undefined) device.orientation = patch.orientation;
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
