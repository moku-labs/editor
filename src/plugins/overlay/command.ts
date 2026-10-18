/**
 * @file overlay plugin — the registry command `editor.overlay { mode }` [cosmetic]: the mirror the
 * tools page and MCP switch the window with. Added in onInit (the registry builds its manifest from
 * entries added before start); its state is `registry.envelope()` (it runs no door).
 */
import type { RunResult } from "../registry/protocol";
import { checkInput, errorCode, wireError } from "../registry/protocol";
import { closeOverlay, openOverlay } from "./modes";
import type { OverlayCtx } from "./types";

/**
 * The input schema of editor.overlay.
 */
const OVERLAY_INPUT: { readonly mode: "string" } = { mode: "string" };

/**
 * Adds `editor.overlay { mode: "string" }` [cosmetic] to the registry. "hidden" closes the window,
 * "pill" and "card" open it; any other string is refused with -32602. Its value is `{ mode }` after
 * the call. A duplicate id throws.
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
     * Switches the window and answers the mode after the call.
     *
     * @param raw - `{ mode }`; anything else is refused with -32602.
     * @returns `{ value: { mode }, state: registry.envelope() }`.
     */
    run: async (raw): Promise<RunResult> => {
      const { mode } = checkInput(OVERLAY_INPUT, raw);
      if (mode === "hidden") closeOverlay(octx);
      else if (mode === "pill" || mode === "card") openOverlay(octx, { mode });
      else {
        throw wireError(
          errorCode.invalidInput,
          'editor.overlay: mode must be "hidden", "pill" or "card".\n  Run it with { mode: "card" }.',
          { reason: "invalid_input", field: "mode" }
        );
      }
      return { value: { mode: octx.state.mode }, state: octx.registry.envelope() };
    }
  });
}
