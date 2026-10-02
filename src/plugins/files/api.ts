/**
 * @file files plugin — api factory: list, read, write, writeBinary, readBinary, resolve, root.
 * Thin: calls sandbox.ts and io.ts.
 */
import type { FilesApi, FilesCtx } from "./types";

/**
 * Creates the files api.
 *
 * @param _ctx - Domain context of files.
 * @example
 * ```ts
 * const saved = await createFilesApi(ctx).write(".moku/editor/layout.json", text, version);
 * ```
 */
export function createFilesApi(_ctx: FilesCtx): FilesApi {
  throw new Error("not implemented");
}
