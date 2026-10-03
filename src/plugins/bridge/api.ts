/**
 * @file bridge plugin — api factory: status (from the phase and channel.heartbeat) and session.
 */
import { channelPlugin } from "../channel";
import { currentStatus } from "./status";
import type { BridgeApi, BridgeCtx, BridgeDeps } from "./types";

/**
 * Builds the bridge api over the state and the channel (unit tests pass a fake channel).
 *
 * @param deps - The state and the channel.
 * @returns The api; both methods read state only.
 */
export function buildBridgeApi(deps: Pick<BridgeDeps, "state" | "channel">): BridgeApi {
  return {
    status: () => currentStatus(deps),
    session: () => deps.state.session
  };
}

/**
 * Creates the bridge api.
 *
 * @param ctx - Plugin context of the bridge.
 * @returns The api over `ctx.state` and `ctx.require(channelPlugin)`.
 */
export function createBridgeApi(ctx: BridgeCtx): BridgeApi {
  return buildBridgeApi({ state: ctx.state, channel: ctx.require(channelPlugin) });
}
