/**
 * @file files plugin — state factory.
 */
import type { FilesConfig, FilesState } from "./types";

/**
 * Creates the initial files state: no root yet, no compiled globs, no locks.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * const state = createFilesState({ config });
 * ```
 */
export function createFilesState(_ctx: { readonly config: Readonly<FilesConfig> }): FilesState {
  throw new Error("not implemented");
}
