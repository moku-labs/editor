/**
 * @file overlay plugin — onInit: adds the editor.overlay command (state from registry.envelope(), R2).
 */
import type { OverlayCtx, OverlayPluginCtx } from "./types";

/**
 * onInit: `registerOverlayCommand(overlayCtxOf(ctx))`.
 *
 * @param _ctx - Plugin context of the overlay.
 * @example
 * ```ts
 * createAgentPlugin("overlay", { onInit: initOverlay });
 * ```
 */
export function initOverlay(_ctx: OverlayPluginCtx): void {
  throw new Error("not implemented");
}

/**
 * Adds `editor.overlay { on: "boolean" }` [cosmetic] to the registry.
 *
 * @param _octx - Domain context.
 * @example
 * ```ts
 * registerOverlayCommand(octx);
 * ```
 */
export function registerOverlayCommand(_octx: OverlayCtx): void {
  throw new Error("not implemented");
}
