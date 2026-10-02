/**
 * @file channel plugin — state factory.
 */
import type { ChannelConfig, ChannelState } from "./types";

/**
 * Creates the initial channel state: no timer, no listeners, no watches.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * const state = createChannelState({ config: { heartbeatMs: 1000 } });
 * ```
 */
export function createChannelState(_ctx: {
  readonly config: Readonly<ChannelConfig>;
}): ChannelState {
  throw new Error("not implemented");
}
