/**
 * @file channel plugin — api factory: read, watch (delegated to watch.ts), run in a microtask,
 * status, heartbeat, onHeartbeat.
 */
import type { ChannelApi, ChannelCtx } from "./types";

/**
 * Creates the channel api over `ctx.require(registryPlugin)`.
 *
 * @param _ctx - Domain context of the channel.
 * @example
 * ```ts
 * (await createChannelApi(ctx).run("game.step", { frames: 1 })).state; // { path, frame: 1841, tainted }
 * ```
 */
export function createChannelApi(_ctx: ChannelCtx): ChannelApi {
  throw new Error("not implemented");
}
