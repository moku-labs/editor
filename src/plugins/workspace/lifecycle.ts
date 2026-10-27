/**
 * @file workspace plugin — onInit (validate config, load prefs, read the OS theme, the density
 * and the hash, built-in keys, Esc layers, palette commands, the `device` and `show` request
 * handlers of link), onStart (window listeners, the manifest, restore, tap, hot reload, engine and
 * session-list listeners; no mount, R3) and onStop (every cleanup, the request handlers among
 * them, timers, tap ripples, the scenario listeners, a pending local preview start, unrender,
 * remove the frame layer and hosts).
 */
import { linkPlugin } from "../link";
import { ERROR_PREFIX } from "../registry/protocol";
import { removeFrameLayer, syncFrame } from "./frame/frame";
import { watchRestores } from "./frame/restored";
import { dropStart } from "./frame/start";
import { clearTaps, watchTaps } from "./frame/taps";
import { syncVeil } from "./frame/veil";
import { stopTicker } from "./handlers";
import { removeHosts } from "./hosts";
import { watchHotReload } from "./hot-reload";
import { registerBuiltIns } from "./keys/builtins";
import { dispatchKey } from "./keys/keymap";
import { reapplyOverlay } from "./overlay";
import { addPaletteItems, builtInCommands } from "./palette/items";
import { watchPeers } from "./peers";
import { osThemeChanged } from "./prefs/apply";
import { refreshDensity, resolveDensity, viewportWidth } from "./prefs/density";
import { loadPrefs } from "./prefs/store";
import { readOsTheme, watchOsTheme } from "./prefs/theme";
import { registerRequests } from "./requests";
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
 * onInit: validation, prefs, OS theme, density, hash, built-in bindings, palette commands and the
 * handlers of the hub's `device` and `show` requests. Sync, no DOM writes.
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
  state.copyOnSelect = prefs.copyOnSelect;

  const hash = globalThis.location?.hash.slice(1);
  if (isWorkspaceId(hash)) state.active = hash;

  registerBuiltIns(ctx);
  addPaletteItems(ctx, builtInCommands(ctx));
  registerRequests(ctx);
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
 * re-apply; the restore toast), link's taps (ripples), the other tools pages of this game (a
 * toast), link's hot reload state (the switch) and link's session lists (the veil, the source
 * pill, the notice). No shell mount here (R3).
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

  // Peers: another tools page of this game, and so of its save, shows a toast (F106).
  trackCleanup(state, watchPeers(ctx));

  // Hot reload: the switch follows the server's state.
  trackCleanup(state, watchHotReload(ctx));

  // Engine: the top bar shows the computer's engine fingerprint once link knows it.
  trackCleanup(
    state,
    link.onEngine(() => {
      state.ui.bump();
    })
  );

  // Sessions: a phone linking or leaving, or the local preview's pause taking hold (the hub sends
  // the list again when a heartbeat's paused flips), repaints the veil, the source pill and the
  // notice; activeSource applied the list before this listener runs.
  trackCleanup(
    state,
    link.onSessions(() => {
      if (state.stopped) return;
      syncVeil(ctx);
      state.ui.bump();
    })
  );
}

/**
 * onStop: runs every cleanup, clears timers, forgets the scenario listeners, drops a pending local
 * preview start without settling it, unrenders the shell, removes the frame layer and the hosts.
 * Late callbacks (a listing that settles after stop among them) see `stopped` and return.
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
  dropStart(state);
  unmountShell(state);
  removeFrameLayer(state);
  removeHosts(state);
  state.listeners.clear();
  state.scenario.listeners.clear();
}
