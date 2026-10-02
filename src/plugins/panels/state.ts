/**
 * @file panels plugin — state factory.
 */
import type { PanelsConfig, PanelsState } from "./types";

/**
 * Creates the initial panels state: no panels, nothing mounted, status connecting.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config (empty).
 * @example
 * ```ts
 * createPanelsState({ config: {} }).panels; // []
 * ```
 */
export function createPanelsState(_ctx: { readonly config: Readonly<PanelsConfig> }): PanelsState {
  throw new Error("not implemented");
}
