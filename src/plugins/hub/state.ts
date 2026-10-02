/**
 * @file hub plugin — state factory.
 */
import type { HubConfig, HubState } from "./types";

/**
 * Creates the initial hub state: empty maps, counters from 1, no token, not served.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createHubState({ config }).served; // false
 * ```
 */
export function createHubState(_ctx: { readonly config: Readonly<HubConfig> }): HubState {
  throw new Error("not implemented");
}
