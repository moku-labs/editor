/**
 * @file pages plugin — the onInit body: validate config, resolve pageDir, build the routes and
 * register them with hub.addRoutes (R3). Must run in init: hub.serve() freezes routes after start.
 */
import type { PagesCtx } from "./types";

/**
 * Validates config, resolves the page folder, creates the routes and calls hub.addRoutes.
 *
 * @param _ctx - Domain context of pages.
 * @throws {Error} `[moku-editor] pages.<field> …` for a bad title, editorUrl or gameUrl.
 * @example
 * ```ts
 * createServerPlugin("pages", { onInit: initPages });
 * ```
 */
export function initPages(_ctx: PagesCtx): void {
  throw new Error("not implemented");
}
