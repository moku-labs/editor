/**
 * @file pages plugin — api factory: routes().
 */
import type { PagesApi, PagesCtx } from "./types";

/**
 * Creates the pages api.
 *
 * @param ctx - Domain context of pages.
 * @returns The PagesApi (`app.pages`).
 * @example
 * ```ts
 * createPagesApi(ctx).routes();
 * ```
 */
export function createPagesApi(ctx: PagesCtx): PagesApi {
  return {
    /**
     * The routes this plugin registered with the hub in onInit (the same frozen object).
     *
     * @returns Route map keyed by URL path under the hub path.
     * @example
     * ```ts
     * Object.keys(editor.pages.routes()); // ["/__editor", "/__editor/", "/__editor/hello", "/__editor/assets/*"]
     * ```
     */
    routes() {
      return ctx.state.routes;
    }
  };
}
