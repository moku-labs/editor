/**
 * @file capture plugin — the page decoder of the `maxWidth` downscale: `createImageBitmap` decodes
 * the PNG data URL; an OffscreenCanvas, or a canvas element where there is none, draws it smaller
 * and encodes a PNG data URL. Outside a browser page every step rejects with a `[moku-editor]` error.
 */
import type { DecodedPicture } from "./types";
import { SHOT_ID } from "./types";

/**
 * The type every downscaled picture is encoded as.
 */
const PNG_TYPE = "image/png";

/**
 * The marker between the media type and the payload of a base64 data URL.
 */
const BASE64_MARK = ";base64,";

/**
 * The bytes per `String.fromCodePoint` call when encoding base64 (keeps the argument list short).
 */
const CHUNK = 0x80_00;

/**
 * Builds the error of a page that cannot downscale.
 *
 * @param problem - What is missing, one short sentence without the prefix.
 * @param hint - What to do about it.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw cannotDownscale("no canvas in this page");
 * ```
 */
function cannotDownscale(problem: string, hint = "Downscaling needs a browser page"): Error {
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
    throw cannotDownscale(
      "the picture is not a base64 data URL",
      "The door answers a PNG data URL"
    );
  }

  const type = image.slice("data:".length, mark);
  const binary = atob(image.slice(mark + BASE64_MARK.length));
  const bytes = Uint8Array.from(binary, char => char.codePointAt(0) ?? 0);

  return new Blob([bytes], { type });
}

/**
 * A PNG Blob as a base64 data URL.
 *
 * @param blob - The encoded picture.
 * @returns `data:image/png;base64,…`.
 */
async function dataUrlOf(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + CHUNK));
  }

  return `data:${PNG_TYPE};base64,${btoa(binary)}`;
}

/**
 * Draws the bitmap over the whole target with high-quality smoothing.
 *
 * @param context - The 2d context of the target canvas, or null when it has none.
 * @param bitmap - The decoded picture.
 * @param width - Target width in pixels.
 * @param height - Target height in pixels.
 * @throws {Error} When the canvas has no 2d context.
 */
function paint(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null,
  bitmap: ImageBitmap,
  width: number,
  height: number
): void {
  if (context === null) throw cannotDownscale("the canvas has no 2d context");

  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
}

/**
 * Draws the bitmap at `width` × `height` and encodes it: on an OffscreenCanvas when the page has
 * one, otherwise on a canvas element.
 *
 * @param bitmap - The decoded picture.
 * @param width - Target width in pixels.
 * @param height - Target height in pixels.
 * @returns The PNG data URL.
 * @throws {Error} When the page has no canvas or the canvas no 2d context.
 */
async function drawPng(bitmap: ImageBitmap, width: number, height: number): Promise<string> {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    paint(canvas.getContext("2d"), bitmap, width, height);
    return dataUrlOf(await canvas.convertToBlob({ type: PNG_TYPE }));
  }

  if (typeof document !== "object" || document === null) {
    throw cannotDownscale("no canvas in this page");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d"), bitmap, width, height);
  return canvas.toDataURL(PNG_TYPE);
}

/**
 * Decodes a PNG data URL in the page with `createImageBitmap`.
 *
 * @param image - The PNG data URL of a shot.
 * @returns The decoded picture: its size, `toPng(width, height)` and `close()`.
 * @throws {Error} Without `createImageBitmap`, or when `image` is not a base64 data URL.
 * @example
 * ```ts
 * const picture = await decodePicture(shot.image);
 * const small = await picture.toPng(540, 960);
 * picture.close();
 * ```
 */
export async function decodePicture(image: string): Promise<DecodedPicture> {
  if (typeof createImageBitmap !== "function") {
    throw cannotDownscale("no createImageBitmap in this page");
  }

  const bitmap = await createImageBitmap(blobOf(image));

  return {
    width: bitmap.width,
    height: bitmap.height,
    toPng: (width, height) => drawPng(bitmap, width, height),
    close: () => {
      bitmap.close();
    }
  };
}
