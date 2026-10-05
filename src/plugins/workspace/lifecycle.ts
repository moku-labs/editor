/**
 * @file workspace plugin — onInit (validate config, load prefs, read the OS theme, the density
 * and the hash, built-in keys, Esc layers, palette commands), onStart (window listeners, the
 * manifest, restore, tap and hot reload listeners; no mount, R3) and onStop (every cleanup, timers, tap ripples,
 * unrender, remove the frame layer and hosts).
 */
import { linkPlugin } from "../link";
import { ERROR_PREFIX } from "../registry/protocol";
import { removeFrameLayer, syncFrame } from "./frame/frame";
import { watchRestores } from "./frame/restored";
import { clearTaps, watchTaps } from "./frame/taps";
import { stopTicker } from "./handlers";
import { removeHosts } from "./hosts";
import { watchHotReload } from "./hot-reload";
import { registerBuiltIns } from "./keys/builtins";
import { dispatchKey } from "./keys/keymap";
import { reapplyOverlay } from "./overlay";
import { addPaletteItems, builtInCommands } from "./palette/items";
import { osThemeChanged } from "./prefs/apply";
import { refreshDensity, resolveDensity, viewportWidth } from "./prefs/density";
import { loadPrefs } from "./prefs/store";
import { readOsTheme, watchOsTheme } from "./prefs/theme";
import { trackCleanup } from "./state";
import { clearToasts } from "./toasts";
import type { WorkspaceConfig, WorkspaceCtx, WorkspaceState } from "./types";
import { unmountShell } from "./ui/mount";
import { isWorkspaceId } from "./workspaces";

/**
 * The startup error of an invalid config field.
 *
 * @param field - The field.
 * @param fix - What to use instead.
 * @returns The error.
 * @example
 * ```ts
 * throw invalid("toastMs", "Use a positive number of milliseconds");
 * ```
 */
function invalid(field: keyof WorkspaceConfig, fix: string): Error {
  return new Error(`${ERROR_PREFIX}workspace.${field} is invalid.\n  ${fix}.`);
}

/**
 * True for a positive finite number.
 *
 * @param value - A config value.
 * @returns Whether it is a usable duration.
 * @example
 * ```ts
 * isPositive(2600); // true
 * ```
 */
function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Validates the config.
 *
 * @param config - The resolved config.
 * @throws {Error} `[moku-editor] workspace.<field> is invalid.\n  <fix>.`
 */
export function validateConfig(config: Readonly<WorkspaceConfig>): void {
  if (!isWorkspaceId(config.defaultWorkspace)) {
    throw invalid("defaultWorkspace", "Use game, flow, render, state, files or console");
  }
  if (typeof config.storageKey !== "string" || config.storageKey === "") {
    throw invalid("storageKey", "Use a non-empty localStorage key");
  }
  if (!isPositive(config.reloadTimeoutMs)) {
    throw invalid("reloadTimeoutMs", "Use a positive number of milliseconds");
  }
  if (!isPositive(config.hotReloadWaitMs)) {
    throw invalid("hotReloadWaitMs", "Use a positive number of milliseconds");
  }
  if (!isPositive(config.toastMs)) {
    throw invalid("toastMs", "Use a positive number of milliseconds");
  }
}

/**
 * onInit: validation, prefs, OS theme, density, hash, built-in bindings and palette commands.
 * Sync, no DOM writes.
 *
 * @param ctx - Domain context of workspace.
 * @throws {Error} `[moku-editor] workspace.<field> is invalid.`
 */
export function initWorkspace(ctx: WorkspaceCtx): void {
  validateConfig(ctx.config);
  const { state } = ctx;

  const prefs = loadPrefs(ctx.config.storageKey, ctx.log);
  state.theme = { chosen: prefs.theme, os: readOsTheme() };
  state.previews = prefs.previews;
  state.device = prefs.device;
  state.density = {
    chosen: prefs.density,
    applied: resolveDensity(prefs.density, viewportWidth())
  };
  state.showTaps = prefs.showTaps;
  state.muted = prefs.muted;

  const hash = globalThis.location?.hash.slice(1);
  if (isWorkspaceId(hash)) state.active = hash;

  registerBuiltIns(ctx);
  addPaletteItems(ctx, builtInCommands(ctx));
}

/**
 * Adds a listener to a target and tracks its removal for onStop.
 *
 * @param state - Workspace state.
 * @param target - window or document (skipped when missing).
 * @param type - The event type.
 * @param listener - The listener.
 * @param capture - Capture phase.
 */
function listen(
  state: WorkspaceState,
  target: EventTarget | undefined,
  type: string,
  listener: (event: Event) => void,
  capture: boolean
): void {
  if (target === undefined) return;
  target.addEventListener(type, listener, capture);
  trackCleanup(state, () => {
    target.removeEventListener(type, listener, capture);
  });
}

/**
 * onStart: window keydown (capture), resize (shell and its top-bar layout, frame, auto density),
 * capture scroll, the OS theme listener, `link.onManifest` (palette counts, everLive, overlay
 * re-apply; the restore toast), link's taps (ripples) and link's hot reload state (the switch). No
 * shell mount here (R3).
 *
 * @param ctx - Domain context of workspace.
 */
export function startWorkspace(ctx: WorkspaceCtx): void {
  const { state } = ctx;
  const window = typeof globalThis.addEventListener === "function" ? globalThis : undefined;

  // Keys: one capture-phase listener dispatches every binding and Esc.
  listen(
    state,
    window,
    "keydown",
    event => {
      if (event instanceof KeyboardEvent) dispatchKey(ctx, event);
    },
    true
  );

  // Layout: a resize re-renders the shell, re-places the frame and re-resolves an auto density;
  // any scroll re-places the frame.
  listen(
    state,
    window,
    "resize",
    () => {
      refreshDensity(ctx);
      state.ui.bump();
      syncFrame(ctx);
    },
    false
  );
  listen(state, globalThis.document, "scroll", () => syncFrame(ctx), true);

  // Theme: follow the OS theme as it changes.
  trackCleanup(
    state,
    watchOsTheme(theme => osThemeChanged(ctx, theme))
  );

  // Manifest: everLive, the shown name and session, the overlay flag and the palette counts
  // follow the attached game.
  const link = ctx.require(linkPlugin);
  trackCleanup(
    state,
    link.onManifest(manifest => {
      if (state.stopped) return;
      if (manifest !== undefined) {
        state.everLive = true;
        state.shown = { game: manifest.game, session: link.session() };
      }
      reapplyOverlay(ctx, manifest);
      state.ui.bump();
    })
  );

  // Restores: a session the bridge restored across Bun's reload toasts once.
  trackCleanup(state, watchRestores(ctx));

  // Taps: a tap in the docked game draws a ripple over it.
  trackCleanup(state, watchTaps(ctx));

  // Hot reload: the switch follows the server's state.
  trackCleanup(state, watchHotReload(ctx));
}

/**
 * onStop: runs every cleanup, clears timers, unrenders the shell, removes the frame layer and
 * the hosts. Late callbacks see `stopped` and return.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopWorkspace(ctx: { readonly state: WorkspaceState }): void {
  const { state } = ctx;
  state.stopped = true;
  for (const cleanup of state.dom.cleanup.splice(0)) cleanup();
  clearToasts(state);
  clearTaps(state);
  stopTicker(state);
  unmountShell(state);
  removeFrameLayer(state);
  removeHosts(state);
  state.listeners.clear();
}
