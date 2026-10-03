/**
 * @file link plugin — the files channel client (R1, R4): no session, works without a game.
 */
import { request } from "../rpc/calls";
import {
  expectShape,
  readFileBinary,
  readFileEntries,
  readFileText,
  readWriteResult
} from "../rpc/shapes";
import type { FilesClient, LinkCtx } from "../types";

/**
 * Creates the files client. Each method sends one files-channel request and checks the result
 * shape; server errors (`version_conflict`, `forbidden_path` …) reject as wire errors.
 *
 * @param ctx - Domain context of link.
 * @returns The FilesClient.
 * @example
 * ```ts
 * const files = createFilesClient(ctx);
 * await files.write(".moku/notes/2026-09-24-first-top-item.md", text);
 * ```
 */
export function createFilesClient(ctx: LinkCtx): FilesClient {
  return {
    /**
     * Lists a folder.
     *
     * @param dir - Folder path relative to the root ("" for the root).
     * @returns The entries.
     * @example
     * ```ts
     * const notes = await app.link.files.list(".moku/notes");
     * ```
     */
    async list(dir) {
      return expectShape(await request(ctx, "files", "list", { dir }), readFileEntries, "list");
    },

    /**
     * Reads a text file.
     *
     * @param path - File path relative to the root.
     * @returns `{ text, version }`.
     * @example
     * ```ts
     * const { text, version } = await app.link.files.read("nodes/merge.ts");
     * ```
     */
    async read(path) {
      return expectShape(await request(ctx, "files", "read", { path }), readFileText, "read");
    },

    /**
     * Writes a text file; with `version`, rejects -32005 when the file changed meanwhile.
     *
     * @param path - File path relative to the root.
     * @param text - The new content.
     * @param version - The version the edit started from.
     * @returns `{ path, bytes, version }`.
     * @example
     * ```ts
     * await app.link.files.write(".moku/notes/2026-09-24-first-top-item.md", text);
     * ```
     */
    async write(path, text, version) {
      const params = version === undefined ? { path, text } : { path, text, version };
      return expectShape(await request(ctx, "files", "write", params), readWriteResult, "write");
    },

    /**
     * Writes an image from a data URL (R1).
     *
     * @param path - Image path relative to the root.
     * @param dataUrl - `data:image/png;base64,…`.
     * @returns `{ path, bytes, version }`.
     * @example
     * ```ts
     * await app.link.files.writeBinary(".moku/captures/2026-09-24-1012-board.png", shot.image);
     * ```
     */
    async writeBinary(path, dataUrl) {
      const result = await request(ctx, "files", "writeBinary", { path, data: dataUrl });
      return expectShape(result, readWriteResult, "writeBinary");
    },

    /**
     * Reads an image back as a data URL (R1).
     *
     * @param path - Image path relative to the root.
     * @returns `{ dataUrl, version }`.
     * @example
     * ```ts
     * const shot = await app.link.files.readBinary(".moku/captures/2026-09-24-1012-board.png");
     * ```
     */
    async readBinary(path) {
      const result = await request(ctx, "files", "readBinary", { path });
      return expectShape(result, readFileBinary, "readBinary");
    }
  };
}
