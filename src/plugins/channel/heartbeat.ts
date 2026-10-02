/**
 * @file channel plugin — config check (onInit), the beat, the heartbeat interval (onStart) and
 * the teardown (onStop).
 */
import type { Heartbeat } from "../registry/protocol";
import type { ChannelConfig, ChannelCtx, ChannelRegistry, ChannelState } from "./types";

/**
 * onInit: rejects a heartbeatMs that is not a finite integer ≥ 100.
 *
 * @param _ctx - Plugin context.
 * @param _ctx.config - Resolved plugin config.
 * @throws {Error} `[moku-editor] channel.heartbeatMs must be a whole number of at least 100.`
 * @example
 * ```ts
 * checkConfig({ config: { heartbeatMs: 1000 } });
 * ```
 */
export function checkConfig(_ctx: { readonly config: Readonly<ChannelConfig> }): void {
  throw new Error("not implemented");
}

/**
 * A frozen beat from the registry clock.
 *
 * @param _registry - The registry slice with `clock()`.
 * @param _now - Epoch ms of the beat.
 * @example
 * ```ts
 * beatOf(registry, Date.now()); // { frame: 1840, paused: true, at: 1790000000000 }
 * ```
 */
export function beatOf(_registry: ChannelRegistry, _now: number): Heartbeat {
  throw new Error("not implemented");
}

/**
 * onStart: starts the setInterval heartbeat (unref'd in Bun).
 *
 * @param _ctx - Domain context of the channel.
 * @example
 * ```ts
 * createAgentPlugin("channel", { onStart: startHeartbeat });
 * ```
 */
export function startHeartbeat(_ctx: ChannelCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: clears the interval, closes every watch, clears the listeners.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createAgentPlugin("channel", { onStop: stopChannel });
 * ```
 */
export function stopChannel(_ctx: { readonly state: ChannelState }): void {
  throw new Error("not implemented");
}
