/**
 * @file workspace plugin — api factory: composes the sub-module functions.
 */

import { linkPlugin } from "../link";
import { setBadge, showWorkspace } from "./actions";
import { DEVICES, deviceChoiceOf } from "./devices";
import { createGameFrame } from "./frame/frame";
import { hostOf } from "./hosts";
import { setHotReload } from "./hot-reload";
import { addEscapeLayer } from "./keys/escape";
import { bindKey } from "./keys/keymap";
import { setOverlayInGame } from "./overlay";
import { addPaletteItems, openPalette } from "./palette/items";
import {
  addPrefsListener,
  chooseDensity,
  chooseTheme,
  patchDevice,
  patchPreview,
  previewState
} from "./prefs/apply";
import { effectiveTheme } from "./prefs/theme";
import { setReference } from "./reference";
import { showToast } from "./toasts";
import type { PreviewZone, WorkspaceApi, WorkspaceCtx } from "./types";
import { mountShell } from "./ui/mount";

/**
 * Registers a preview zone; the remover drops it unless a newer zone replaced it.
 *
 * @param ctx - Domain context of workspace.
 * @param ws - The workspace.
 * @param zone - The zone.
 * @returns Removes it.
 */
function addPreviewZone(
  ctx: WorkspaceCtx,
  ws: Parameters<WorkspaceApi["previewZone"]>[0],
  zone: PreviewZone
): () => void {
  const { zones } = ctx.state.frame;
  zones.set(ws, zone);
  ctx.state.ui.bump();
  return () => {
    if (zones.get(ws) === zone) zones.delete(ws);
    ctx.state.ui.bump();
  };
}

/**
 * Creates the workspace api. The contract of each member is on `WorkspaceApi` in `types.ts`.
 *
 * @param ctx - Domain context of workspace.
 * @returns The WorkspaceApi (`app.workspace`, `tools.workspace`).
 */
export function createWorkspaceApi(ctx: WorkspaceCtx): WorkspaceApi {
  const { state } = ctx;
  const frame = createGameFrame(ctx);

  return {
    active: () => state.active,

    show: ws => {
      showWorkspace(ctx, ws);
    },

    theme: () => effectiveTheme(state.theme),

    setTheme: theme => {
      chooseTheme(ctx, theme);
    },

    density: () => state.density.applied,

    setDensity: value => {
      chooseDensity(ctx, value);
    },

    preview: ws => previewState(state, ws),

    setPreview: (ws, patch) => {
      patchPreview(ctx, ws, patch);
    },

    device: () => deviceChoiceOf(state.device),

    setDevice: patch => {
      patchDevice(ctx, patch);
    },

    devices: () => DEVICES,

    gameFrame: () => frame,

    palette: {
      add: item => addPaletteItems(ctx, item),

      open: query => {
        openPalette(ctx, query);
      }
    },

    toast: (message, file) => {
      showToast(ctx, message, file);
    },

    mount: element => {
      mountShell(ctx, element);
    },

    host: ws => hostOf(state, ws),

    badge: (ws, badge) => {
      setBadge(state, ws, badge);
    },

    previewZone: (ws, element, insets) => addPreviewZone(ctx, ws, { element, insets }),

    keys: {
      bind: binding => bindKey(ctx, binding),

      escape: (layer, close) => addEscapeLayer(ctx, layer, close)
    },

    overlayInGame: () => state.overlayInGame,

    setOverlayInGame: on => setOverlayInGame(ctx, on, "panel"),

    reference: () => state.reference,

    setReference: on => {
      setReference(ctx, on);
    },

    hotReload: () => ctx.require(linkPlugin).hotReload(),

    setHotReload: on => setHotReload(ctx, on),

    onPrefs: fn => addPrefsListener(state, fn)
  };
}
