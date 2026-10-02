/**
 * @file hub plugin — onStart (new token, silent interval) and onStop (clear timers, close every
 * socket with 1001, forget sessions, token undefined). The Bun server itself belongs to the game.
 */
import type { HubCtx, HubState } from "./types";

/**
 * onStart: a new token per start (never logged) and the silent interval (unref'd).
 *
 * @param _ctx - Domain context of the hub.
 * @example
 * ```ts
 * createServerPlugin("hub", { onStart: startHub });
 * ```
 */
export function startHub(_ctx: HubCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: clears the timers, closes every socket with 1001 "editor stopping", clears the maps.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createServerPlugin("hub", { onStop: stopHub });
 * ```
 */
export function stopHub(_ctx: { readonly state: HubState }): void {
  throw new Error("not implemented");
}
