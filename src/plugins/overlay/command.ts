/**
 * @file overlay plugin — onInit: adds the editor.overlay command (state from registry.envelope(), R2).
 */
import type { RunResult } from "../registry/protocol";
import { checkInput } from "../registry/protocol";
import { closeOverlay, openOverlay } from "./api";
import { overlayCtxOf } from "./context";
import type { OverlayCtx, OverlayPluginCtx } from "./types";

/**
 * The input schema of editor.overlay.
 */
const OVERLAY_INPUT: { readonly on: "boolean" } = { on: "boolean" };

/**
 * onInit: `registerOverlayCommand(overlayCtxOf(ctx))`.
 *
 * @param ctx - Plugin context of the overlay.
 */
export function initOverlay(ctx: OverlayPluginCtx): void {
  registerOverlayCommand(overlayCtxOf(ctx));
}

/**
 * Adds `editor.overlay { on: "boolean" }` [cosmetic] to the registry. Its value is `{ on }`
 * after the call; its state is the registry's envelope (it runs no door). A duplicate id throws.
 *
 * @param octx - Domain context.
 */
export function registerOverlayCommand(octx: OverlayCtx): void {
  octx.registry.add({
    descriptor: {
      id: "editor.overlay",
      title: "Overlay in game",
      input: OVERLAY_INPUT,
      effect: "cosmetic"
    },
    /**
     * Switches the overlay and answers the state after the call.
     *
     * @param raw - `{ on: boolean }`; anything else is refused with -32602.
     * @returns `{ value: { on }, state: registry.envelope() }`.
     */
    run: async (raw): Promise<RunResult> => {
      const { on } = checkInput(OVERLAY_INPUT, raw);
      if (on) openOverlay(octx);
      else closeOverlay(octx);
      return { value: { on: octx.state.open }, state: octx.registry.envelope() };
    }
  });
}
