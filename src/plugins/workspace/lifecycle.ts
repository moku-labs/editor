/**
 * @file workspace plugin — onInit (validate config, load prefs, read the OS theme and the hash,
 * built-in keys, Esc layers, palette commands), onStart (window listeners, the manifest listener;
 * no mount, R3) and onStop (every cleanup, timers, unrender, remove the frame layer and hosts).
 */
import type { WorkspaceCtx, WorkspaceState } from "./types";

/**
 * onInit: validation, prefs, OS theme, hash, built-in bindings and palette commands. Sync, no DOM writes.
 *
 * @param _ctx - Domain context of workspace.
 * @throws {Error} `[moku-editor] workspace.<field> is invalid.`
 * @example
 * ```ts
 * createToolsPlugin("workspace", { onInit: initWorkspace });
 * ```
 */
export function initWorkspace(_ctx: WorkspaceCtx): void {
  throw new Error("not implemented");
}

/**
 * onStart: window keydown, resize, capture scroll, matchMedia listeners and link.onManifest.
 *
 * @param _ctx - Domain context of workspace.
 * @example
 * ```ts
 * createToolsPlugin("workspace", { onStart: startWorkspace });
 * ```
 */
export function startWorkspace(_ctx: WorkspaceCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: runs every cleanup, clears timers, unrenders the shell, removes the frame layer and hosts.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("workspace", { onStop: stopWorkspace });
 * ```
 */
export function stopWorkspace(_ctx: { readonly state: WorkspaceState }): void {
  throw new Error("not implemented");
}
