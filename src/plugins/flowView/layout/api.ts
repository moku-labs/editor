/**
 * @file flowView layout module — the flows and layout namespaces of the api.
 */
import type { FlowCtx } from "../types";
import type { FlowsApi, LayoutApi } from "./types";

/**
 * Creates the flows api (expand, collapse, enter, up).
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * createFlowsApi(ctx).enter("main/board");
 * ```
 */
export function createFlowsApi(_ctx: FlowCtx): FlowsApi {
  throw new Error("not implemented");
}

/**
 * Creates the layout api (pinnedCount, reset).
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * await createLayoutApi(ctx).reset();
 * ```
 */
export function createLayoutApi(_ctx: FlowCtx): LayoutApi {
  throw new Error("not implemented");
}
