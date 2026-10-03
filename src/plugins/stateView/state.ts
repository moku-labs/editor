/**
 * @file stateView plugin — state factory.
 */
import type { Config, StateViewState } from "./types";

/**
 * Creates the initial stateView state: no baseline, note "none", seq 0, empty maps.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createStateViewState({ config }).note; // "none"
 * ```
 */
export function createStateViewState(_ctx: { readonly config: Readonly<Config> }): StateViewState {
  throw new Error("not implemented");
}
