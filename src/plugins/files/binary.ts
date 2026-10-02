/**
 * @file files plugin — data URL codec for captures (hub decodes the files-channel writeBinary
 * data with decodeDataUrl) and the image extensions of readBinary / writeBinary (R7).
 */
import { Buffer } from "node:buffer";
import { forbidden, invalid } from "./errors";

/**
 * Image extensions accepted by readBinary and writeBinary (case-insensitive, R7).
 */
export const IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

/**
 * The mime of each image extension.
 */
const MIME_OF: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);

/**
 * The only data URL shape decodeDataUrl accepts.
 */
const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([\d+/A-Za-z]*={0,2})$/;

/**
 * The lowercased extension of the last segment of a path, `""` when it has none.
 *
 * @param path - A relative posix path.
 * @returns The extension with its dot, lowercased.
 * @example
 * ```ts
 * extensionOf("a/b.PNG"); // ".png"
 * ```
 */
function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * True when the path ends with an image extension (R7).
 *
 * @param path - A relative posix path.
 * @returns Whether readBinary / writeBinary may touch it.
 * @example
 * ```ts
 * isImagePath(".moku/captures/a.PNG"); // true
 * ```
 */
export function isImagePath(path: string): boolean {
  return MIME_OF.has(extensionOf(path));
}

/**
 * The image mime of a path by its extension.
 *
 * @param path - A path with an image extension.
 * @returns The mime, e.g. `image/png`.
 * @throws {Error} -32004 `forbidden_path` when the path is not an image.
 * @example
 * ```ts
 * imageMime("shot.jpg"); // "image/jpeg"
 * ```
 */
export function imageMime(path: string): string {
  const mime = MIME_OF.get(extensionOf(path));
  if (mime === undefined) throw forbidden(path);

  return mime;
}

/**
 * Decodes `data:image/(png|jpeg|webp|gif);base64,<payload>`. The mime must match the extension of
 * the target path: a mismatch throws -32602 with `field: "data"`, a path that is not an image
 * throws -32004.
 *
 * @param text - The data URL.
 * @param path - The target relative path; its extension must match the mime.
 * @returns The decoded bytes.
 * @throws {Error} -32004 for a non-image path, -32602 `field: "data"` for any other problem.
 * @example
 * ```ts
 * const path = ".moku/captures/2026-09-24-1012-board.png";
 * await files.writeBinary(path, decodeDataUrl(shot.image, path));
 * ```
 */
export function decodeDataUrl(text: string, path: string): Uint8Array {
  const mime = imageMime(path);
  const match = typeof text === "string" ? DATA_URL.exec(text) : null; // eslint-disable-line unicorn/no-null -- RegExp.exec's own miss value

  if (match === null) {
    throw invalid("data", `writeBinary: data must be a base64 png, jpeg, webp or gif URL: ${path}`);
  }
  if (match[1] !== mime) {
    throw invalid("data", `writeBinary: data type ${match[1]} does not match ${path}`);
  }

  return Uint8Array.from(Buffer.from(match[2] ?? "", "base64"));
}

/**
 * Builds the readBinary data URL, mime from the extension.
 *
 * @param bytes - The file bytes.
 * @param path - The relative path (for the mime).
 * @returns `data:<mime>;base64,<bytes>`.
 * @throws {Error} -32004 when the path is not an image.
 * @example
 * ```ts
 * encodeDataUrl(bytes, "a.PNG"); // "data:image/png;base64,…"
 * ```
 */
export function encodeDataUrl(bytes: Uint8Array, path: string): string {
  const payload = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");

  return `data:${imageMime(path)};base64,${payload}`;
}
