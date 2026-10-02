/**
 * @file pages plugin — state factory.
 */
import type { PagesConfig, PagesState } from "./types";

/**
 * Creates the initial pages state: no page folder, no template, no routes.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createPagesState({ config }).routes; // {}
 * ```
 */
export function createPagesState(_ctx: { readonly config: Readonly<PagesConfig> }): PagesState {
  throw new Error("not implemented");
}
