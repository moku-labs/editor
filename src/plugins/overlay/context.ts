/**
 * @file overlay plugin — builds the domain context from the plugin context.
 */
import { channelPlugin } from "../channel";
import { registryPlugin } from "../registry";
import type { OverlayCtx, OverlayPluginCtx } from "./types";

/**
 * `{ config, state, log, registry: ctx.require(registryPlugin), channel: ctx.require(channelPlugin) }`.
 * The real registry and channel apis satisfy the narrower OverlayCtx shapes structurally.
 *
 * @param ctx - Plugin context of the overlay.
 * @returns The domain context of the overlay modules.
 * @example
 * ```ts
 * const octx = overlayCtxOf(ctx);
 * octx.registry.manifest().commands.length; // 14
 * ```
 */
export function overlayCtxOf(ctx: OverlayPluginCtx): OverlayCtx {
  return {
    config: ctx.config,
    state: ctx.state,
    log: ctx.log,
    registry: ctx.require(registryPlugin),
    channel: ctx.require(channelPlugin)
  };
}
