/**
 * @file link plugin — state factory.
 */
import type { Config, LinkState } from "./types";

/**
 * Creates the initial link state: status connecting, nothing attached, ids from 1.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * const state = createLinkState({ config: { retryMs: 1000, boot: "#moku-editor-boot" } });
 * ```
 */
export function createLinkState(_ctx: { readonly config: Readonly<Config> }): LinkState {
  throw new Error("not implemented");
}
