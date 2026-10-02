/**
 * @file flowView inspector module — the inspector's internal api.
 */
import type { FlowCtx } from "../types";
import type { InspectorApi } from "./types";

/**
 * Creates the inspector api.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * await createInspectorApi(ctx).openCode("board/merge");
 * ```
 */
export function createInspectorApi(_ctx: FlowCtx): InspectorApi {
  throw new Error("not implemented");
}
