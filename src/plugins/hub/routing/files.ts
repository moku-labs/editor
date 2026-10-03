/**
 * @file hub plugin — the files channel: params checked with checkInput, then list, read, write,
 * writeBinary (the data URL decoded with its path, R1) and readBinary of the files plugin. Files
 * errors are wire errors already and pass through unchanged.
 */
import { decodeDataUrl } from "../../files";
import type { FilesApi } from "../../files/types";
import type {
  FileBinary,
  FileEntry,
  FileText,
  InputSchema,
  Json,
  WriteResult
} from "../../registry/protocol";
import { checkInput, errorCode, toWireValue, wireError } from "../../registry/protocol";

/**
 * Params of `list`.
 */
const LIST = { dir: "string" } satisfies InputSchema;

/**
 * Params of `read` and `readBinary`.
 */
const PATH = { path: "string" } satisfies InputSchema;

/**
 * Params of `write`.
 */
const WRITE = { path: "string", text: "string", version: "string?" } satisfies InputSchema;

/**
 * Params of `writeBinary` (`data` is a data URL).
 */
const WRITE_BINARY = { path: "string", data: "string" } satisfies InputSchema;

/**
 * What a files call answers.
 */
type FilesResult = FileEntry[] | FileText | WriteResult | FileBinary;

/**
 * Runs one files method with checked params.
 *
 * @param files - The files api.
 * @param method - The files-channel method.
 * @param params - The raw params (`{}` when absent).
 * @returns The files result.
 * @throws {Error} -32602 for bad params or a bad data URL, -32601 for an unknown method, or the
 * files api's own wire error.
 * @example
 * ```ts
 * await callFiles(files, "read", { path: "src/a.ts" }); // { text, version }
 * ```
 */
async function callFiles(files: FilesApi, method: string, params: Json): Promise<FilesResult> {
  switch (method) {
    case "list": {
      return files.list(checkInput(LIST, params).dir);
    }
    case "read": {
      return files.read(checkInput(PATH, params).path);
    }
    case "write": {
      const { path, text, version } = checkInput(WRITE, params);
      return files.write(path, text, version);
    }
    case "writeBinary": {
      const { path, data } = checkInput(WRITE_BINARY, params);
      return files.writeBinary(path, decodeDataUrl(data, path));
    }
    case "readBinary": {
      return files.readBinary(checkInput(PATH, params).path);
    }
    default: {
      throw wireError(errorCode.unknownMethod, `unknown method files.${method}`, {
        retryable: false
      });
    }
  }
}

/**
 * Dispatches a files-channel request to the files plugin; the result passes through toWireValue
 * (readonly protocol shapes become Json).
 *
 * @param files - The files api (`ctx.require(filesPlugin)`).
 * @param method - The files-channel method.
 * @param params - The request params.
 * @returns The Json result.
 * @throws {Error} Rejects with -32602, -32601 or the files wire error (-32004, -32005 …).
 * @example
 * ```ts
 * const result = await dispatchFiles(files, "list", { dir: "src" });
 * ```
 */
export async function dispatchFiles(
  files: FilesApi,
  method: string,
  params: Json | undefined
): Promise<Json> {
  return toWireValue(await callFiles(files, method, params ?? {}));
}
