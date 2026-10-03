/**
 * @file flowView focus module — the focus namespace of the api.
 */
import type { FlowCtx } from "../types";
import type { FocusApi } from "./types";

/**
 * Creates the focus api.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * createFocusApi(ctx).select("board/merge"); // true
 * ```
 */
export function createFocusApi(_ctx: FlowCtx): FocusApi {
  throw new Error("not implemented");
}
