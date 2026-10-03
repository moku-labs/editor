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
 * @example
 * ```ts
 * buildBridgeApi({ state, channel }).status(); // { kind: "connecting" }
 * ```
 */
export function buildBridgeApi(deps: Pick<BridgeDeps, "state" | "channel">): BridgeApi {
  return {
    /**
     * The link status: connecting, live or paused (from the channel heartbeat), or lost.
     *
     * @returns A fresh LinkStatus; never silent or empty.
     * @example
     * ```ts
     * editor.bridge.status(); // { kind: "live", frame: 1840 }
     * ```
     */
    status: () => currentStatus(deps),
    /**
     * The session id the hub gave this page after its hello (R6).
     *
     * @returns The id, or undefined before it arrives and after the socket closes.
     * @example
     * ```ts
     * editor.bridge.session(); // "s-7f3a"
     * ```
     */
    session: () => deps.state.session
  };
}

/**
 * Creates the bridge api.
 *
 * @param ctx - Plugin context of the bridge.
 * @returns The api over `ctx.state` and `ctx.require(channelPlugin)`.
 * @example
 * ```ts
 * createBridgeApi(ctx).session(); // "s-7f3a"
 * ```
 */
export function createBridgeApi(ctx: BridgeCtx): BridgeApi {
  return buildBridgeApi({ state: ctx.state, channel: ctx.require(channelPlugin) });
}
