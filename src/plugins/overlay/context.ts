/**
 * @file overlay plugin — builds the domain context from the plugin context.
 */
import type { OverlayCtx, OverlayPluginCtx } from "./types";

/**
 * `{ config, state, log, registry: ctx.require(registryPlugin), channel: ctx.require(channelPlugin) }`.
 *
 * @param _ctx - Plugin context of the overlay.
 * @example
 * ```ts
 * const octx = overlayCtxOf(ctx);
 * ```
 */
export function overlayCtxOf(_ctx: OverlayPluginCtx): OverlayCtx {
  throw new Error("not implemented");
}
