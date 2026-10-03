/**
 * @file overlay plugin — hooks: the global agent event bridge:status feeds the link dot.
 */
import type { AgentEvents } from "../../config";
import { overlayCtxOf } from "./context";
import { paint } from "./paint";
import type { OverlayCtx, OverlayHooks, OverlayPluginCtx } from "./types";

/**
 * The overlay's hooks factory (`hooks: createHandlers`). `bridge:status` is a global agent event,
 * so no dependency on the opt-in bridge is needed; in a QA build it never fires.
 *
 * @param ctx - Plugin context of the overlay.
 * @returns The hook map.
 */
export function createHandlers(ctx: OverlayPluginCtx): OverlayHooks {
  return { "bridge:status": handleBridgeStatus(overlayCtxOf(ctx)) };
}

/**
 * Stores status and session; repaints when open.
 *
 * @param octx - Domain context.
 * @returns The bridge:status handler.
 */
export function handleBridgeStatus(
  octx: OverlayCtx
): (payload: AgentEvents["bridge:status"]) => void {
  return payload => {
    octx.state.link = payload.status;
    octx.state.session = payload.session;
    if (octx.state.open) paint(octx);
  };
}
