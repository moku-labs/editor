/**
 * @file files plugin — onStart opens the project index of the root without waiting for it;
 * onStop ends its watch and closes it.
 */
import { closeIndex, openIndex } from "./project";
import type { FilesCtx, FilesState } from "./types";

/**
 * onStart: starts the open of the project index; `find` waits for `state.opening`.
 *
 * @param ctx - Domain context of files.
 */
export function startFiles(ctx: FilesCtx): void {
  ctx.state.opening = openIndex(ctx);
}

/**
 * onStop: ends the watch, closes the index and leaves the state off `"stopped"`.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopFiles(ctx: { readonly state: FilesState }): void {
  closeIndex(ctx.state);
}
