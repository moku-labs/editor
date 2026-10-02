/**
 * @file link plugin — onStart (read the boot tag, open the socket, start the silence watch) and
 * onStop (close the socket, clear every timer, reject pending calls with link_closed).
 */
import type { LinkCtx, LinkState } from "./types";

/**
 * onStart: reads `#moku-editor-boot`, opens the websocket, starts the silence interval. Does not
 * await the socket.
 *
 * @param _ctx - Domain context of link.
 * @example
 * ```ts
 * createToolsPlugin("link", { onStart: startLink });
 * ```
 */
export function startLink(_ctx: LinkCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: stopped = true, clears the timers, rejects pending calls, closes the socket (1000).
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("link", { onStop: stopLink });
 * ```
 */
export function stopLink(_ctx: { readonly state: LinkState }): void {
  throw new Error("not implemented");
}
