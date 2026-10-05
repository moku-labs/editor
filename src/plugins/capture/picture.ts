/**
 * @file capture plugin — the picture of editor.capture and editor.sheet: crop, then downscale,
 * then encode (JPEG 0.8 by default, D-34) over the injected picture decoder. A page that cannot
 * decode or encode answers the door's own PNG, so the screenshot still works.
 */
import { errorCode, wireError } from "../registry/protocol";
import { cropRect, scaledSize } from "./scale";
import type {
  CaptureDeps,
  CropRequest,
  DecodedPicture,
  EncodeOptions,
  PictureRequest,
  PictureSize,
  PixelRect
} from "./types";
import { SHOT_ID } from "./types";

/**
 * Builds the -32602 refusal of a crop that keeps nothing of the picture.
 *
 * @param field - The input field the crop came from.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw outsideThePicture("rect");
 * ```
 */
function outsideThePicture(field: CropRequest["field"]): Error {
  return wireError(
    errorCode.invalidInput,
    `[moku-editor] ${SHOT_ID}: the rect lies outside the picture.\n  Pass a rect inside the game page.`,
    { reason: "invalid_input", retryable: false, id: SHOT_ID, field }
  );
}

/**
 * The crop of a request in picture pixels, or undefined when the request keeps the whole picture.
 *
 * @param picture - The size of the decoded picture.
 * @param request - The picture request.
 * @returns The crop.
 * @throws {Error} -32602 `invalid_input` naming the crop's field when it lies outside the picture.
 */
function pixelCropOf(picture: PictureSize, request: PictureRequest): PixelRect | undefined {
  if (request.crop === undefined) return undefined;

  const crop = cropRect(request.crop.rect, picture, request.deviceWidth);
  if (crop === undefined) throw outsideThePicture(request.crop.field);

  return crop;
}

/**
 * How to encode a decoded picture for a request: crop first, then shrink the kept part to
 * `maxWidth`, then the format and the quality. A png request that neither crops nor shrinks keeps
 * the picture as it is.
 *
 * @param picture - The size of the decoded picture.
 * @param request - The picture request.
 * @returns The encode options, or undefined when the door's picture is the answer.
 * @throws {Error} -32602 `invalid_input` naming `key` or `rect` when the crop lies outside the picture.
 * @example
 * ```ts
 * encodeOptionsOf({ width: 1080, height: 1920 }, { maxWidth: 540, crop: undefined, format: "jpeg", quality: 0.8, deviceWidth: 393 });
 * // { size: { width: 540, height: 960 }, format: "jpeg", quality: 0.8 }
 * ```
 */
export function encodeOptionsOf(
  picture: PictureSize,
  request: PictureRequest
): EncodeOptions | undefined {
  const crop = pixelCropOf(picture, request);
  const kept = crop ?? picture;
  const scaled =
    request.maxWidth === undefined
      ? undefined
      : scaledSize(kept.width, kept.height, request.maxWidth);

  if (request.format === "png" && crop === undefined && scaled === undefined) return undefined;

  const size = scaled ?? { width: kept.width, height: kept.height };
  const { format, quality } = request;

  return crop === undefined ? { size, format, quality } : { crop, size, format, quality };
}

/**
 * Logs `capture:encode-failed` and answers the door's picture.
 *
 * @param image - The door's data URL.
 * @param error - What failed.
 * @param deps - The log.
 * @returns The door's data URL.
 */
function fallBack(image: string, error: unknown, deps: Pick<CaptureDeps, "log">): string {
  const message = error instanceof Error ? error.message : String(error);
  deps.log.warn("capture:encode-failed", { message });
  return image;
}

/**
 * Decodes the door's picture; a page that cannot logs `capture:encode-failed`.
 *
 * @param image - The door's data URL.
 * @param deps - The picture decoder and the log.
 * @returns The decoded picture, or undefined when decoding failed.
 */
async function decodeQuietly(
  image: string,
  deps: Pick<CaptureDeps, "decode" | "log">
): Promise<DecodedPicture | undefined> {
  try {
    return await deps.decode(image);
  } catch (error) {
    fallBack(image, error, deps);
    return undefined;
  }
}

/**
 * Encodes a decoded picture; a page that cannot answers the door's picture.
 *
 * @param image - The door's data URL.
 * @param picture - The decoded picture.
 * @param options - The encode options.
 * @param deps - The log.
 * @returns The data URL to answer.
 */
async function encodeQuietly(
  image: string,
  picture: DecodedPicture,
  options: EncodeOptions,
  deps: Pick<CaptureDeps, "log">
): Promise<string> {
  try {
    return await picture.encode(options);
  } catch (error) {
    return fallBack(image, error, deps);
  }
}

/**
 * True when the request asks the door's picture unchanged: png, no crop, no `maxWidth`.
 *
 * @param request - The picture request.
 * @returns Whether nothing needs decoding.
 */
function keepsTheDoorPicture(request: PictureRequest): boolean {
  return request.format === "png" && request.crop === undefined && request.maxWidth === undefined;
}

/**
 * The picture editor.capture and editor.sheet answer: the door's PNG cropped to `crop`, shrunk to
 * `maxWidth` and encoded in `format` at `quality`. A png request without crop or `maxWidth`
 * decodes nothing. A page that cannot decode or encode answers the door's PNG and logs
 * `capture:encode-failed`, so the screenshot still works.
 *
 * @param image - The door's PNG data URL.
 * @param request - The checked picture request.
 * @param deps - The picture decoder and the log.
 * @returns The data URL to answer (its media type follows what the page encoded).
 * @throws {Error} -32602 `invalid_input` naming `key` or `rect` when the crop lies outside the picture.
 * @example
 * ```ts
 * const image = await renderPicture(shot.image, { maxWidth: 1080, crop: undefined, format: "jpeg", quality: 0.8, deviceWidth: 393 }, deps);
 * image.startsWith("data:image/jpeg"); // true in a browser page
 * ```
 */
export async function renderPicture(
  image: string,
  request: PictureRequest,
  deps: Pick<CaptureDeps, "decode" | "log">
): Promise<string> {
  if (keepsTheDoorPicture(request)) return image;

  const picture = await decodeQuietly(image, deps);
  if (picture === undefined) return image;

  try {
    const options = encodeOptionsOf(picture, request);
    return options === undefined ? image : await encodeQuietly(image, picture, options, deps);
  } finally {
    picture.close();
  }
}
