/**
 * @file files plugin — the onInit body: resolves and checks the root, compiles the globs.
 */
import type { FilesCtx } from "./types";

/**
 * Resolves `config.root` (realpath, must be a folder), stores rootReal, compiles allow and deny.
 *
 * @param _ctx - Domain context of files.
 * @throws {Error} `[moku-editor] files.root "<root>" is not a directory.` or an empty allow list.
 * @example
 * ```ts
 * createServerPlugin("files", { onInit: validateFilesConfig });
 * ```
 */
export function validateFilesConfig(_ctx: FilesCtx): void {
  throw new Error("not implemented");
}
