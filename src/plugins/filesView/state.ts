/**
 * @file filesView plugin — state factory.
 */
import type { Config, FilesViewState } from "./types";

/**
 * Creates the initial filesView state: empty collections, overrides {}, nothing indexed.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createFilesViewState({ config }).tabs; // []
 * ```
 */
export function createFilesViewState(_ctx: { readonly config: Readonly<Config> }): FilesViewState {
  throw new Error("not implemented");
}
