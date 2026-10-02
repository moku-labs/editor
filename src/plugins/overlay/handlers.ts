/**
 * @file overlay plugin — hooks: the global agent event bridge:status feeds the link dot.
 */
import type { AgentEvents } from "../../config";
import type { OverlayCtx, OverlayHooks, OverlayPluginCtx } from "./types";

/**
 * The overlay's hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Plugin context of the overlay.
 * @example
 * ```ts
 * createAgentPlugin("overlay", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: OverlayPluginCtx): OverlayHooks {
  throw new Error("not implemented");
}

/**
 * Stores status and session; repaints when open.
 *
 * @param _octx - Domain context.
 * @example
 * ```ts
 * handleBridgeStatus(octx)({ status: { kind: "live", frame: 12 } });
 * ```
 */
export function handleBridgeStatus(
  _octx: OverlayCtx
): (payload: AgentEvents["bridge:status"]) => void {
  throw new Error("not implemented");
}
