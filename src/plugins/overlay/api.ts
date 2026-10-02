/**
 * @file overlay plugin — api factory (open, close, isOpen) and the open/close actions the
 * editor.overlay command shares.
 */
import type { OverlayApi, OverlayCtx, OverlayPluginCtx } from "./types";

/**
 * Creates the overlay api over overlayCtxOf(ctx).
 *
 * @param _ctx - Plugin context of the overlay.
 * @example
 * ```ts
 * createOverlayApi(ctx).open();
 * ```
 */
export function createOverlayApi(_ctx: OverlayPluginCtx): OverlayApi {
  throw new Error("not implemented");
}

/**
 * Opens: shows the host, computes the cheats, watches game.render, starts the paint interval.
 *
 * @param _octx - Domain context.
 * @example
 * ```ts
 * openOverlay(octx);
 * ```
 */
export function openOverlay(_octx: OverlayCtx): void {
  throw new Error("not implemented");
}

/**
 * Closes: hides the host, unwatches game.render, clears the interval.
 *
 * @param _octx - Domain context.
 * @example
 * ```ts
 * closeOverlay(octx);
 * ```
 */
export function closeOverlay(_octx: OverlayCtx): void {
  throw new Error("not implemented");
}
