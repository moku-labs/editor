/**
 * @file panels plugin — onStart (mount the active workspace, palette items, manifest recheck) and
 * onStop (unmount every panel, run cleanup).
 */
import type { PanelsCtx, PanelsState } from "./types";

/**
 * onStart: mounts the active workspace, adds one palette item per panel, subscribes onManifest.
 *
 * @param _ctx - Domain context of panels.
 * @example
 * ```ts
 * createToolsPlugin("panels", { onStart: startPanels });
 * ```
 */
export function startPanels(_ctx: PanelsCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: unmounts every mounted panel (every unwatch runs), runs cleanup, clears mounted.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("panels", { onStop: stopPanels });
 * ```
 */
export function stopPanels(_ctx: { readonly state: PanelsState }): void {
  throw new Error("not implemented");
}
