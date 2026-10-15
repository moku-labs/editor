/**
 * @file overlay plugin — api factory: open, close, toggle, isOpen, mode, commands. The domain
 * context is resolved at the first call (the kernel builds the hooks before every api exists).
 */
import { overlayCtxOf } from "./context";
import { overlayCommands } from "./model/game";
import { closeOverlay, openOverlay, toggleOverlay } from "./modes";
import type { OverlayApi, OverlayCtx, OverlayPluginCtx } from "./types";

/**
 * Creates the overlay api over overlayCtxOf(ctx).
 *
 * @param ctx - Plugin context of the overlay.
 * @returns The api.
 */
export function createOverlayApi(ctx: OverlayPluginCtx): OverlayApi {
  const octx = (): OverlayCtx => overlayCtxOf(ctx);

  return {
    open: options => {
      openOverlay(octx(), options);
    },
    close: () => {
      closeOverlay(octx());
    },
    toggle: () => {
      toggleOverlay(octx());
    },
    isOpen: () => ctx.state.mode !== "hidden",
    mode: () => ctx.state.mode,
    commands: () => overlayCommands(octx().registry)
  };
}
