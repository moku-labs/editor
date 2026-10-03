/**
 * @file hub plugin — state factory.
 */
import type { HubConfig, HubState } from "./types";

/**
 * Creates the initial hub state: empty maps, counters from 1, no token, not served.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns The fresh state.
 * @example
 * ```ts
 * createHubState({ config }).served; // false
 * ```
 */
export function createHubState(_ctx: { readonly config: Readonly<HubConfig> }): HubState {
  return {
    token: undefined,
    served: false,
    routes: new Map(),
    origins: new Set(),
    conns: new Map(),
    nextConn: 1,
    sessions: new Map(),
    pending: new Map(),
    nextCallId: 1,
    shared: new Map(),
    silentTimer: undefined
  };
}
