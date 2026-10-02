/**
 * @file pages plugin — Content-Type by extension (text types get `; charset=utf-8`).
 */

/**
 * The Content-Type of a served file.
 *
 * @param _path - A file path or URL path.
 * @example
 * ```ts
 * contentType("assets/index-3f7a.css"); // "text/css; charset=utf-8"
 * ```
 */
export function contentType(_path: string): string {
  throw new Error("not implemented");
}
