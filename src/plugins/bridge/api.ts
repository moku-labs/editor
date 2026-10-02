/**
 * @file bridge plugin — api factory: status (from the phase and channel.heartbeat) and session.
 */
import type { BridgeApi, BridgeCtx } from "./types";

/**
 * Creates the bridge api.
 *
 * @param _ctx - Plugin context of the bridge.
 * @example
 * ```ts
 * createBridgeApi(ctx).session(); // "s-7f3a"
 * ```
 */
export function createBridgeApi(_ctx: BridgeCtx): BridgeApi {
  throw new Error("not implemented");
}
