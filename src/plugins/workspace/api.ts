/**
 * @file workspace plugin — api factory: composes the sub-module functions.
 */
import { setBadge, showWorkspace } from "./actions";
import { DEVICES, presetOf } from "./devices";
import { createGameFrame } from "./frame/frame";
import { hostOf } from "./hosts";
import { addEscapeLayer } from "./keys/escape";
import { bindKey } from "./keys/keymap";
import { setOverlayInGame } from "./overlay";
import { addPaletteItems, openPalette } from "./palette/items";
import {
  addPrefsListener,
  chooseTheme,
  patchDevice,
  patchPreview,
  previewState
} from "./prefs/apply";
import { effectiveTheme } from "./prefs/theme";
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
 * @example
 * ```ts
 * addPreviewZone(ctx, "flow", { element: canvas, insets: { bottom: 56 } });
 * ```
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
 * Creates the workspace api.
 *
 * @param ctx - Domain context of workspace.
 * @returns The WorkspaceApi (`app.workspace`, `tools.workspace`).
 * @example
 * ```ts
 * createWorkspaceApi(ctx).show("game");
 * ```
 */
export function createWorkspaceApi(ctx: WorkspaceCtx): WorkspaceApi {
  const { state } = ctx;
  const frame = createGameFrame(ctx);

  return {
    /**
     * The shown workspace.
     *
     * @returns Its id.
     * @example
     * ```ts
     * workspace.active(); // "flow"
     * ```
     */
    active() {
      return state.active;
    },

    /**
     * Shows a workspace; emits workspace:changed when it changes; writes `#<ws>` into the URL.
     *
     * @param ws - The workspace.
     * @example
     * ```ts
     * workspace.show("game");
     * ```
     */
    show(ws) {
      showWorkspace(ctx, ws);
    },

    /**
     * The effective theme (chosen, else OS).
     *
     * @returns light or dark.
     * @example
     * ```ts
     * workspace.theme(); // "dark"
     * ```
     */
    theme() {
      return effectiveTheme(state.theme);
    },

    /**
     * Sets the theme, or toggles it when omitted; persists the choice.
     *
     * @param theme - The theme, omitted to toggle.
     * @example
     * ```ts
     * workspace.setTheme();
     * ```
     */
    setTheme(theme) {
      chooseTheme(ctx, theme);
    },

    /**
     * The preview state of a non-Game workspace.
     *
     * @param ws - The workspace.
     * @returns Prefs plus the float size in px.
     * @example
     * ```ts
     * workspace.preview("flow").size; // "S"
     * ```
     */
    preview(ws) {
      return previewState(state, ws);
    },

    /**
     * Patches preview prefs; persists; toasts a visibility change.
     *
     * @param ws - The workspace.
     * @param patch - visible, size and/or corner.
     * @example
     * ```ts
     * workspace.setPreview("render", { visible: false });
     * ```
     */
    setPreview(ws, patch) {
      patchPreview(ctx, ws, patch);
    },

    /**
     * The current device: the preset (DeviceSpec) and the orientation.
     *
     * @returns The device choice.
     * @example
     * ```ts
     * workspace.device().preset.w; // 393
     * ```
     */
    device() {
      return { preset: presetOf(state.device.preset), orientation: state.device.orientation };
    },

    /**
     * Changes preset and/or orientation; resizes the frame; persists.
     *
     * @param patch - preset and/or orientation.
     * @example
     * ```ts
     * workspace.setDevice({ orientation: "landscape" });
     * ```
     */
    setDevice(patch) {
      patchDevice(ctx, patch);
    },

    /**
     * The six presets in display order.
     *
     * @returns The DeviceSpec list.
     * @example
     * ```ts
     * workspace.devices().map(device => device.name);
     * ```
     */
    devices() {
      return DEVICES;
    },

    /**
     * The single game frame.
     *
     * @returns The GameFrame api (one object for the app's life).
     * @example
     * ```ts
     * await workspace.gameFrame().reload({ restore: true });
     * ```
     */
    gameFrame() {
      return frame;
    },

    palette: {
      /**
       * Adds palette items; an existing id is replaced.
       *
       * @param item - One item or many.
       * @returns Removes them.
       * @example
       * ```ts
       * const remove = workspace.palette.add({ id: "cmd:capture", group: "Commands", label: "Take a screenshot", run });
       * ```
       */
      add(item) {
        return addPaletteItems(ctx, item);
      },

      /**
       * Opens the palette.
       *
       * @param query - The initial query.
       * @example
       * ```ts
       * workspace.palette.open("board/");
       * ```
       */
      open(query) {
        openPalette(ctx, query);
      }
    },

    /**
     * Shows a toast; `file` renders in mono after a middle dot.
     *
     * @param message - One line.
     * @param file - A file to name.
     * @example
     * ```ts
     * workspace.toast("✓ Note saved", ".moku/notes/2026-09-24-first-top-item.md");
     * ```
     */
    toast(message, file) {
      showToast(ctx, message, file);
    },

    /**
     * Mounts the shell; the first call also creates the frame layer and the iframe.
     *
     * @param element - The mount element.
     * @example
     * ```ts
     * editor.workspace.mount(document.querySelector<HTMLElement>("[data-editor-root]")!);
     * ```
     */
    mount(element) {
      mountShell(ctx, element);
    },

    /**
     * The host element of a workspace (created on the first call, also before mount).
     *
     * @param ws - The workspace.
     * @returns The host.
     * @example
     * ```ts
     * panels.mountInto("flow", workspace.host("flow"));
     * ```
     */
    host(ws) {
      return hostOf(state, ws);
    },

    /**
     * Sets or clears the rail badge of a workspace.
     *
     * @param ws - The workspace.
     * @param badge - The badge, undefined to clear.
     * @example
     * ```ts
     * workspace.badge("console", { count: 3, tone: "error", label: "2 warn · 1 error" });
     * ```
     */
    badge(ws, badge) {
      setBadge(state, ws, badge);
    },

    /**
     * Where the preview floats in a workspace.
     *
     * @param ws - The workspace.
     * @param element - The zone element.
     * @param insets - Insets in px, or a function that reads them.
     * @returns Removes the zone.
     * @example
     * ```ts
     * workspace.previewZone("flow", canvasEl, () => ({ top: 56, bottom: 56 }));
     * ```
     */
    previewZone(ws, element, insets) {
      return addPreviewZone(ctx, ws, { element, insets });
    },

    keys: {
      /**
       * Adds a key binding.
       *
       * @param binding - The binding.
       * @returns Removes it.
       * @example
       * ```ts
       * workspace.keys.bind({ keys: "n", label: "New note", workspace: "flow", run });
       * ```
       */
      bind(binding) {
        return bindKey(ctx, binding);
      },

      /**
       * Adds an Esc closer on a layer.
       *
       * @param layer - The layer.
       * @param close - Returns true when it closed something.
       * @returns Removes it.
       * @example
       * ```ts
       * workspace.keys.escape("noteEditor", () => editor.close());
       * ```
       */
      escape(layer, close) {
        return addEscapeLayer(ctx, layer, close);
      }
    },

    /**
     * The overlay-in-game flag.
     *
     * @returns Whether it is on.
     * @example
     * ```ts
     * workspace.overlayInGame(); // false
     * ```
     */
    overlayInGame() {
      return state.overlayInGame;
    },

    /**
     * Sets the overlay-in-game flag (runs `editor.overlay`, origin panel).
     *
     * @param on - The new flag.
     * @returns Resolves when the run settled.
     * @example
     * ```ts
     * await workspace.setOverlayInGame(true);
     * ```
     */
    setOverlayInGame(on) {
      return setOverlayInGame(ctx, on, "panel");
    },

    /**
     * Listens to preference changes (theme, preview, device).
     *
     * @param fn - The listener.
     * @returns Removes it.
     * @example
     * ```ts
     * const off = workspace.onPrefs(prefs => rerender(prefs));
     * ```
     */
    onPrefs(fn) {
      return addPrefsListener(state, fn);
    }
  };
}
