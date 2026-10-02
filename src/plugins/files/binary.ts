/**
 * @file files plugin — data URL codec for captures (hub decodes the files-channel writeBinary
 * data with decodeDataUrl) and the image extensions of readBinary / writeBinary (R7).
 */

/**
 * Image extensions accepted by readBinary and writeBinary (case-insensitive, R7).
 */
export const IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

/**
 * Decodes `data:image/(png|jpeg|webp|gif);base64,<payload>`. The mime must match the extension of
 * the target path: a mismatch throws -32602 with `field: "data"`, a path that is not an image
 * throws -32004.
 *
 * @param _text - The data URL.
 * @param _path - The target relative path; its extension must match the mime.
 * @example
 * ```ts
 * const path = ".moku/captures/2026-09-24-1012-board.png";
 * await files.writeBinary(path, decodeDataUrl(shot.image, path));
 * ```
 */
export function decodeDataUrl(_text: string, _path: string): Uint8Array {
  throw new Error("not implemented");
}

/**
 * Builds the readBinary data URL, mime from the extension.
 *
 * @param _bytes - The file bytes.
 * @param _path - The relative path (for the mime).
 * @example
 * ```ts
 * encodeDataUrl(bytes, "a.PNG"); // "data:image/png;base64,…"
 * ```
 */
export function encodeDataUrl(_bytes: Uint8Array, _path: string): string {
  throw new Error("not implemented");
}

/**
 * The image mime of a path by its extension.
 *
 * @param _path - A path with an image extension.
 * @example
 * ```ts
 * imageMime("shot.jpg"); // "image/jpeg"
 * ```
 */
export function imageMime(_path: string): string {
  throw new Error("not implemented");
}
