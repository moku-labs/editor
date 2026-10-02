/**
 * @file overlay plugin — state factory.
 */
import type { Config, OverlayState } from "./types";

/**
 * Creates the initial overlay state: closed, not mounted, empty.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createOverlayState({ config }).open; // false
 * ```
 */
export function createOverlayState(_ctx: { readonly config: Readonly<Config> }): OverlayState {
  throw new Error("not implemented");
}
