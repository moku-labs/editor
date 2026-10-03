/**
 * @file channel plugin — state factory.
 */
import type { ChannelConfig, ChannelState } from "./types";

/**
 * Creates the initial channel state: no timer, no listeners, no watches.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns A fresh state with empty listener and watch sets.
 */
export function createChannelState(_ctx: {
  readonly config: Readonly<ChannelConfig>;
}): ChannelState {
  return { timer: undefined, listeners: new Set(), watches: new Set() };
}
