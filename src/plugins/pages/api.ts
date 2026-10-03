/**
 * @file pages plugin — api factory: routes().
 */
import type { PagesApi, PagesCtx } from "./types";

/**
 * Creates the pages api.
 *
 * @param _ctx - Domain context of pages.
 * @example
 * ```ts
 * createPagesApi(ctx).routes();
 * ```
 */
export function createPagesApi(_ctx: PagesCtx): PagesApi {
  throw new Error("not implemented");
}
