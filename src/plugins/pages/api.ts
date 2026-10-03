/**
 * @file pages plugin — api factory: routes().
 */
import type { PagesApi, PagesCtx } from "./types";

/**
 * Creates the pages api. The member contract lives on PagesApi in types.ts.
 *
 * @param ctx - Domain context of pages.
 * @returns The PagesApi (`app.pages`).
 */
export function createPagesApi(ctx: PagesCtx): PagesApi {
  return {
    routes: () => ({ ...ctx.state.routes })
  };
}
