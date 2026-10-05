/**
 * @file capture plugin — the `maxWidth` of editor.capture: the range check, the scaled size and the
 * downscale over the injected picture decoder. A page that cannot downscale answers the full picture.
 */
import { errorCode, wireError } from "../registry/protocol";
import type { CaptureDeps, DecodedPicture, PictureDecoder } from "./types";
import { MAX_MAX_WIDTH, MIN_MAX_WIDTH, SHOT_ID } from "./types";

/**
 * Checks the optional `maxWidth` of editor.capture: a whole number from 64 to 4096.
 *
 * @param maxWidth - The checked number input, or undefined when absent.
 * @returns The same value.
 * @throws {Error} -32602 `invalid_input` naming `maxWidth`.
 * @example
 * ```ts
 * const maxWidth = checkMaxWidth(input.maxWidth); // 1080, or undefined when absent
 * ```
 */
export function checkMaxWidth(maxWidth: number | undefined): number | undefined {
  if (maxWidth === undefined) return undefined;

  const isInRange =
    Number.isInteger(maxWidth) && maxWidth >= MIN_MAX_WIDTH && maxWidth <= MAX_MAX_WIDTH;
  if (isInRange) return maxWidth;

  throw wireError(
    errorCode.invalidInput,
    `[moku-editor] ${SHOT_ID}: maxWidth must be a whole number from ${String(MIN_MAX_WIDTH)} to ${String(MAX_MAX_WIDTH)}.\n  Pass the widest picture you want, in pixels.`,
    { reason: "invalid_input", retryable: false, id: SHOT_ID, field: "maxWidth" }
  );
}

/**
 * The size of a picture shrunk to `maxWidth`, aspect kept and height rounded (at least 1 px).
 *
 * @param width - Picture width in pixels.
 * @param height - Picture height in pixels.
 * @param maxWidth - The widest picture wanted.
 * @returns The new size, or undefined when the picture is not wider than `maxWidth`.
 * @example
 * ```ts
 * scaledSize(1080, 1920, 540); // { width: 540, height: 960 }
 * scaledSize(800, 600, 1080); // undefined: already narrow enough
 * ```
 */
export function scaledSize(
  width: number,
  height: number,
  maxWidth: number
): { readonly width: number; readonly height: number } | undefined {
  if (width <= maxWidth) return undefined;

  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/**
 * Draws a decoded picture at its scaled size; a narrow picture is answered as it is.
 *
 * @param image - The original data URL.
 * @param picture - The decoded picture.
 * @param maxWidth - The widest picture wanted.
 * @returns The data URL to answer.
 */
async function drawScaled(
  image: string,
  picture: DecodedPicture,
  maxWidth: number
): Promise<string> {
  const size = scaledSize(picture.width, picture.height, maxWidth);

  return size === undefined ? image : picture.toPng(size.width, size.height);
}

/**
 * Decodes a picture, draws it scaled and frees it, whatever happens.
 *
 * @param image - The original data URL.
 * @param maxWidth - The widest picture wanted.
 * @param decode - The picture decoder.
 * @returns The data URL to answer.
 */
async function downscale(image: string, maxWidth: number, decode: PictureDecoder): Promise<string> {
  const picture = await decode(image);

  try {
    return await drawScaled(image, picture, maxWidth);
  } finally {
    picture.close();
  }
}

/**
 * Shrinks a shot to `maxWidth` in the page (aspect kept, PNG data URL). A picture that is not wider
 * is answered unchanged. A page that cannot decode or draw it answers the full picture and logs
 * `capture:downscale-failed`, so the screenshot still works.
 *
 * @param image - The PNG data URL of the shot.
 * @param maxWidth - The checked `maxWidth`.
 * @param deps - The picture decoder and the log.
 * @returns The data URL to answer.
 * @example
 * ```ts
 * const image = await fitWidth(shot.image, 540, deps); // a 1080 × 1920 shot comes back 540 × 960
 * ```
 */
export async function fitWidth(
  image: string,
  maxWidth: number,
  deps: Pick<CaptureDeps, "decode" | "log">
): Promise<string> {
  try {
    return await downscale(image, maxWidth, deps.decode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log.warn("capture:downscale-failed", { message });
    return image;
  }
}
