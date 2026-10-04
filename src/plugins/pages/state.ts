/**
 * @file pages plugin — state factory.
 */
import type { PagesConfig, PagesState } from "./types";

/**
 * Creates the initial pages state: no page folder, no template, no routes, hot reload owned by
 * the server with HMR off.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns The fresh state; onInit fills pageDir and routes, the page route fills template.
 */
export function createPagesState(_ctx: { readonly config: Readonly<PagesConfig> }): PagesState {
  return {
    pageDir: undefined,
    template: undefined,
    routes: {},
    hot: { hmr: false, owner: "server" }
  };
}
