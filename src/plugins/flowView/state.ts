/**
 * @file flowView plugin — state factory: composes the module slices and the view store.
 */
import type { FlowViewConfig, FlowViewState } from "./types";

/**
 * Creates the composed flowView state.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createFlowViewState({ config }).data.stale; // false
 * ```
 */
export function createFlowViewState(_ctx: {
  readonly config: Readonly<FlowViewConfig>;
}): FlowViewState {
  throw new Error("not implemented");
}
