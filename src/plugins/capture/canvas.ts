/**
 * @file capture plugin — the page decoder of editor.capture and editor.sheet: `createImageBitmap`
 * decodes the PNG data URL; an OffscreenCanvas, or a canvas element where there is none, draws the
 * crop (or the whole picture) at the asked size and encodes a JPEG or PNG data URL. Outside a
 * browser page every step rejects with a `[moku-editor]` error.
 */
import type { DecodedPicture, EncodeOptions, PictureFormat } from "./types";
import { SHOT_ID } from "./types";

/**
 * The media type of each format.
 */
const MEDIA_TYPE: Readonly<Record<PictureFormat, string>> = {
  jpeg: "image/jpeg",
  png: "image/png"
};

/**
 * The marker between the media type and the payload of a base64 data URL.
 */
const BASE64_MARK = ";base64,";

/**
 * The bytes per `String.fromCodePoint` call when encoding base64 (keeps the argument list short).
 */
const CHUNK = 0x80_00;

/**
 * Builds the error of a page that cannot encode.
 *
 * @param problem - What is missing, one short sentence without the prefix.
 * @param hint - What to do about it.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw cannotEncode("no canvas in this page");
 * ```
 */
function cannotEncode(problem: string, hint = "Encoding needs a browser page"): Error {
  return new Error(`[moku-editor] ${SHOT_ID}: ${problem}.\n  ${hint}.`);
}

/**
 * The bytes of a base64 data URL as a Blob of its media type.
 *
 * @param image - A data URL such as `data:image/png;base64,iVBOR…`.
 * @returns The Blob.
 * @throws {Error} When `image` is not a base64 data URL.
 * @example
 * ```ts
 * blobOf("data:image/png;base64,AQID").size; // 3
 * ```
 */
function blobOf(image: string): Blob {
  const mark = image.indexOf(BASE64_MARK);

  if (!image.startsWith("data:") || mark === -1) {
    throw cannotEncode("the picture is not a base64 data URL", "The door answers a PNG data URL");
  }

  const type = image.slice("data:".length, mark);
  const binary = atob(image.slice(mark + BASE64_MARK.length));
  const bytes = Uint8Array.from(binary, char => char.codePointAt(0) ?? 0);

  return new Blob([bytes], { type });
}

/**
 * A Blob as a base64 data URL of the blob's own type: a page that cannot encode the asked type
 * hands back a PNG, and the data URL says so.
 *
 * @param blob - The encoded picture.
 * @param fallbackType - The asked type, used when the blob has none.
 * @returns `data:<type>;base64,…`.
 */
async function dataUrlOf(blob: Blob, fallbackType: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = blob.type === "" ? fallbackType : blob.type;
  let binary = "";

  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + CHUNK));
  }

  return `data:${type};base64,${btoa(binary)}`;
}

/**
 * Draws the crop of the bitmap (or all of it) over the whole target with high-quality smoothing.
 *
 * @param context - The 2d context of the target canvas, or null when it has none.
 * @param bitmap - The decoded picture.
 * @param options - The crop and the target size.
 * @throws {Error} When the canvas has no 2d context.
 */
function paint(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null,
  bitmap: ImageBitmap,
  options: EncodeOptions
): void {
  if (context === null) throw cannotEncode("the canvas has no 2d context");

  const { crop, size } = options;
  context.imageSmoothingQuality = "high";

  if (crop === undefined) {
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return;
  }

  context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
}

/**
 * Encodes on an OffscreenCanvas: `convertToBlob` with the type, and the quality for a JPEG.
 *
 * @param bitmap - The decoded picture.
 * @param options - Crop, size, format and quality.
 * @returns The data URL of the blob's type.
 * @throws {Error} When the canvas has no 2d context.
 */
async function encodeOffscreen(bitmap: ImageBitmap, options: EncodeOptions): Promise<string> {
  const { size, format, quality } = options;
  const type = MEDIA_TYPE[format];
  const canvas = new OffscreenCanvas(size.width, size.height);

  paint(canvas.getContext("2d"), bitmap, options);
  const blob = await canvas.convertToBlob(format === "jpeg" ? { type, quality } : { type });

  return dataUrlOf(blob, type);
}

/**
 * Encodes on a canvas element (a page without OffscreenCanvas): `toDataURL(type, quality)` for a
 * JPEG, `toDataURL(type)` for a PNG.
 *
 * @param bitmap - The decoded picture.
 * @param options - Crop, size, format and quality.
 * @returns The data URL.
 * @throws {Error} When the page has no document or the canvas no 2d context.
 */
function encodeOnElement(bitmap: ImageBitmap, options: EncodeOptions): string {
  if (typeof document !== "object" || document === null) {
    throw cannotEncode("no canvas in this page");
  }

  const { size, format, quality } = options;
  const type = MEDIA_TYPE[format];
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  paint(canvas.getContext("2d"), bitmap, options);

  return format === "jpeg" ? canvas.toDataURL(type, quality) : canvas.toDataURL(type);
}

/**
 * Draws and encodes the bitmap: on an OffscreenCanvas when the page has one, otherwise on a
 * canvas element.
 *
 * @param bitmap - The decoded picture.
 * @param options - Crop, size, format and quality.
 * @returns The data URL.
 * @throws {Error} When the page has no canvas or the canvas no 2d context.
 */
async function encodeBitmap(bitmap: ImageBitmap, options: EncodeOptions): Promise<string> {
  if (typeof OffscreenCanvas === "function") return encodeOffscreen(bitmap, options);

  return encodeOnElement(bitmap, options);
}

/**
 * Decodes a PNG data URL in the page with `createImageBitmap`.
 *
 * @param image - The PNG data URL of a shot.
 * @returns The decoded picture: its size, `encode(options)` and `close()`.
 * @throws {Error} Without `createImageBitmap`, or when `image` is not a base64 data URL.
 * @example
 * ```ts
 * const picture = await decodePicture(shot.image);
 * const small = await picture.encode({ size: { width: 540, height: 960 }, format: "jpeg", quality: 0.8 });
 * picture.close();
 * ```
 */
export async function decodePicture(image: string): Promise<DecodedPicture> {
  if (typeof createImageBitmap !== "function") {
    throw cannotEncode("no createImageBitmap in this page");
  }

  const bitmap = await createImageBitmap(blobOf(image));

  return {
    width: bitmap.width,
    height: bitmap.height,
    encode: options => encodeBitmap(bitmap, options),
    close: () => {
      bitmap.close();
    }
  };
}
