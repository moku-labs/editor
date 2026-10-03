/**
 * @file filesView plugin — api factory: composes tree, tabs, preview and links.
 */
import type { FilesViewApi, FilesViewCtx } from "./types";

/**
 * Creates the filesView api.
 *
 * @param _ctx - Domain context of filesView.
 * @example
 * ```ts
 * createFilesViewApi(ctx).usedBy("nodes/merge.ts").nodes; // [{ flow: "board", node: "merge" }]
 * ```
 */
export function createFilesViewApi(_ctx: FilesViewCtx): FilesViewApi {
  throw new Error("not implemented");
}
