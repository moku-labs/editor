/**
 * @file overlay plugin — onStart (host, shadow root, stylesheet, isolation listener, hidden card;
 * opens when config.open) and onStop (removes everything).
 */
import type { OverlayCtx, OverlayPluginCtx, OverlayState } from "./types";

/**
 * onStart: `mountOverlay(overlayCtxOf(ctx), ctx.has("bridge"))`.
 *
 * @param _ctx - Plugin context of the overlay.
 * @example
 * ```ts
 * createAgentPlugin("overlay", { onStart: startOverlay });
 * ```
 */
export function startOverlay(_ctx: OverlayPluginCtx): void {
  throw new Error("not implemented");
}

/**
 * Creates the host in the mount element (or body), the shadow root and the sheet; no DOM → warn.
 *
 * @param _octx - Domain context.
 * @param _hasBridge - Whether the bridge is composed (link dot).
 * @param _doc - The document; globalThis.document by default.
 * @example
 * ```ts
 * mountOverlay(octx, true);
 * ```
 */
export function mountOverlay(_octx: OverlayCtx, _hasBridge: boolean, _doc?: Document): void {
  throw new Error("not implemented");
}

/**
 * onStop: clears the interval, stops the watch, unrenders, removes the listener and the host.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createAgentPlugin("overlay", { onStop: unmountOverlay });
 * ```
 */
export function unmountOverlay(_ctx: { readonly state: OverlayState }): void {
  throw new Error("not implemented");
}
