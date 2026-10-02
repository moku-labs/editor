/**
 * @file hub plugin — api factory: assembles serve, token, sessions, fetch, websocket, addRoutes,
 * guard and path from the modules. No logic of its own.
 */
import type { HubApi, HubCtx } from "./types";

/**
 * Creates the hub api.
 *
 * @param _ctx - Domain context of the hub.
 * @example
 * ```ts
 * createHubApi(ctx).path(); // "/__editor"
 * ```
 */
export function createHubApi(_ctx: HubCtx): HubApi {
  throw new Error("not implemented");
}
