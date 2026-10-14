/**
 * @file hub plugin — state factory.
 */
import type { HubConfig, HubState } from "./types";

/**
 * Creates the initial hub state: empty maps, counters from 1, no token, not served, routes open,
 * nothing published, no selection page, no port yet, device mode off with no device, no pairing
 * and no engine published yet.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns The fresh state.
 */
export function createHubState(_ctx: { readonly config: Readonly<HubConfig> }): HubState {
  return {
    token: undefined,
    served: false,
    routesFrozen: false,
    routes: new Map(),
    origins: new Set(),
    conns: new Map(),
    nextConn: 1,
    sessions: new Map(),
    pending: new Map(),
    nextCallId: 1,
    shared: new Map(),
    silentTimer: undefined,
    published: new Map(),
    selectionConn: undefined,
    editorPort: undefined,
    deviceOrigins: new Set(),
    deviceServers: undefined,
    deviceListen: undefined,
    confirm: undefined,
    devices: new Map(),
    pairing: { queue: [], asking: undefined, cooldown: new Map() },
    engineId: undefined
  };
}
