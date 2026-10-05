/**
 * @file filesView plugin — what a file is shown as, by its path. The colour language is the
 * shared `langOf` of panels/shared/highlight (R4), not decided here.
 */
import { isSeriesIndexPath } from "../preview/series";
import type { FileKind } from "../types";

/**
 * The image extensions of the files channel (R7): read through `readBinary`.
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif"
]);

/**
 * Extensions shown as code.
 */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css"
]);

/**
 * The lower-case extension of a path's base name, with its dot.
 *
 * @param path - A relative path.
 * @returns ".ts", or `""` without an extension (a leading dot is no extension).
 * @example
 * ```ts
 * extensionOf("nodes/Merge.TS"); // ".ts"
 * ```
 */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/**
 * What a file is shown as: series index, markdown, json, image, code, else text.
 *
 * @param path - A relative path.
 * @returns The kind.
 * @example
 * ```ts
 * kindOf(".moku/captures/2026-10-05/series-1015/index.json"); // "series"
 * ```
 */
export function kindOf(path: string): FileKind {
  if (isSeriesIndexPath(path)) return "series";
  const extension = extensionOf(path);
  if (extension === ".md") return "markdown";
  if (extension === ".json") return "json";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  return CODE_EXTENSIONS.has(extension) ? "code" : "text";
}

/**
 * True for every kind with a text body (all but images): these can be edited.
 *
 * @param kind - A file kind.
 * @returns Whether the kind has text.
 * @example
 * ```ts
 * isTextKind("image"); // false
 * ```
 */
export function isTextKind(kind: FileKind): boolean {
  return kind !== "image";
}
