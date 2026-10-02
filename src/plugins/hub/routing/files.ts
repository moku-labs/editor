/**
 * @file hub plugin — routing/files.ts (skeleton stubs, implemented in its wave).
 */

import type { FilesApi } from "../../files/types";
import type { Json } from "../../registry/protocol";

/**
 * Skeleton stub for `dispatchFiles`; implemented in its wave.
 *
 * @param _files - The files.
 * @param _method - The method.
 * @param _params - The params.
 * @example
 * ```ts
 * dispatchFiles();
 * ```
 */
export function dispatchFiles(
  _files: FilesApi,
  _method: string,
  _params: Json | undefined
): Promise<Json> {
  throw new Error("not implemented");
}
