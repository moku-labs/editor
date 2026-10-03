/**
 * @file flowView plugin — api factory: `{ camera, focus, flows, layout, notes }` from the modules.
 */
import type { FlowCtx, FlowViewApi } from "./types";

/**
 * Creates the namespaced flowView api.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * createFlowViewApi(ctx).focus.select("board/merge");
 * ```
 */
export function createFlowViewApi(_ctx: FlowCtx): FlowViewApi {
  throw new Error("not implemented");
}
