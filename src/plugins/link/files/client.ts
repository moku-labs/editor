/**
 * @file link plugin — the files channel client (R1, R4): no session, works without a game.
 */
import { request } from "../rpc/calls";
import {
  expectShape,
  readFileBinary,
  readFileEntries,
  readFileText,
  readFoundList,
  readWriteResult
} from "../rpc/shapes";
import type { FilesClient, LinkCtx } from "../types";

/**
 * Creates the files client. Each method sends one files-channel request and checks the result
 * shape; server errors (`version_conflict`, `forbidden_path` …) reject as wire errors. The
 * contract of each member is on `FilesClient` in `types.ts`.
 *
 * @param ctx - Domain context of link.
 * @returns The FilesClient.
 */
export function createFilesClient(ctx: LinkCtx): FilesClient {
  return {
    list: async dir =>
      expectShape(await request(ctx, "files", "list", { dir }), readFileEntries, "list"),

    read: async path =>
      expectShape(await request(ctx, "files", "read", { path }), readFileText, "read"),

    write: async (path, text, version) => {
      const params = version === undefined ? { path, text } : { path, text, version };
      return expectShape(await request(ctx, "files", "write", params), readWriteResult, "write");
    },

    writeBinary: async (path, dataUrl) => {
      const result = await request(ctx, "files", "writeBinary", { path, data: dataUrl });
      return expectShape(result, readWriteResult, "writeBinary");
    },

    readBinary: async path => {
      const result = await request(ctx, "files", "readBinary", { path });
      return expectShape(result, readFileBinary, "readBinary");
    },

    find: async key =>
      expectShape(await request(ctx, "files", "find", { key }), readFoundList, "find")
  };
}
