/**
 * @file pages plugin — Content-Type by extension (text types get `; charset=utf-8`).
 */

/**
 * The type of each known extension, and whether it is text.
 */
const TYPES: ReadonlyMap<string, readonly [type: string, text: boolean]> = new Map([
  ["js", ["text/javascript", true]],
  ["mjs", ["text/javascript", true]],
  ["css", ["text/css", true]],
  ["map", ["application/json", true]],
  ["json", ["application/json", true]],
  ["html", ["text/html", true]],
  ["svg", ["image/svg+xml", true]],
  ["png", ["image/png", false]],
  ["jpg", ["image/jpeg", false]],
  ["jpeg", ["image/jpeg", false]],
  ["webp", ["image/webp", false]],
  ["woff2", ["font/woff2", false]],
  ["woff", ["font/woff", false]],
  ["wasm", ["application/wasm", false]],
  ["txt", ["text/plain", true]],
  ["md", ["text/plain", true]]
]);

/**
 * The Content-Type of a served file.
 *
 * @param path - A file path or URL path.
 * @returns The type; text types carry `; charset=utf-8`, unknown ones are octet-stream.
 * @example
 * ```ts
 * contentType("assets/index-3f7a.css"); // "text/css; charset=utf-8"
 * ```
 */
export function contentType(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const known = dot === -1 ? undefined : TYPES.get(name.slice(dot + 1).toLowerCase());
  if (known === undefined) return "application/octet-stream";

  const [type, text] = known;
  return text ? `${type}; charset=utf-8` : type;
}
