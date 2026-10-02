/**
 * @file bridge plugin — state factory.
 */
import type { BridgeConfig, BridgeState } from "./types";

/**
 * Creates the initial bridge state: phase idle, status connecting, empty maps.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * const state = createBridgeState({ config });
 * ```
 */
export function createBridgeState(_ctx: { readonly config: Readonly<BridgeConfig> }): BridgeState {
  throw new Error("not implemented");
}
