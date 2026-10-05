/**
 * @file capture plugin — the size math of editor.capture and editor.sheet: the `maxWidth` range
 * check, the scaled size and the crop of a page rect in picture pixels. Pure.
 */
import type { SelectionRect } from "../registry/protocol";
import { errorCode, wireError } from "../registry/protocol";
import type { PictureSize, PixelRect } from "./types";
import { CROP_PADDING, MAX_MAX_WIDTH, MIN_MAX_WIDTH, SHOT_ID } from "./types";

/**
 * Checks the optional `maxWidth` of editor.capture or editor.sheet: a whole number from 64 to 4096.
 *
 * @param maxWidth - The checked number input, or undefined when absent.
 * @param id - The command, named in the error.
 * @returns The same value.
 * @throws {Error} -32602 `invalid_input` naming `maxWidth`.
 * @example
 * ```ts
 * const maxWidth = checkMaxWidth(input.maxWidth); // 1080, or undefined when absent
 * ```
 */
export function checkMaxWidth(
  maxWidth: number | undefined,
  id: string = SHOT_ID
): number | undefined {
  if (maxWidth === undefined) return undefined;

  const isInRange =
    Number.isInteger(maxWidth) && maxWidth >= MIN_MAX_WIDTH && maxWidth <= MAX_MAX_WIDTH;
  if (isInRange) return maxWidth;

  throw wireError(
    errorCode.invalidInput,
    `[moku-editor] ${id}: maxWidth must be a whole number from ${String(MIN_MAX_WIDTH)} to ${String(MAX_MAX_WIDTH)}.\n  Pass the widest picture you want, in pixels.`,
    { reason: "invalid_input", retryable: false, id, field: "maxWidth" }
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
): PictureSize | undefined {
  if (width <= maxWidth) return undefined;

  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/**
 * Clamps a number to the range from 0 to `max`.
 *
 * @param value - The number.
 * @param max - The largest value.
 * @returns The clamped number.
 */
function clampTo(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/**
 * The crop of a page rect in picture pixels: the rect scaled by `picture.width / deviceWidth`,
 * padded by 8 × scale on every side, widened to whole pixels and clamped to the picture.
 *
 * @param page - The rect in page CSS px (`game.locate`, `game.rect` or the input `rect`).
 * @param picture - The size of the decoded picture.
 * @param deviceWidth - The game page width in CSS px; 0 (headless) counts as scale 1.
 * @returns The crop, or undefined when nothing of the rect lies inside the picture.
 * @example
 * ```ts
 * cropRect({ x: 10, y: 20, w: 100, h: 50 }, { width: 1080, height: 1920 }, 540);
 * // { x: 4, y: 24, width: 232, height: 132 }: scale 2, 16 px padding
 * ```
 */
export function cropRect(
  page: SelectionRect,
  picture: PictureSize,
  deviceWidth: number
): PixelRect | undefined {
  const scale = deviceWidth > 0 ? picture.width / deviceWidth : 1;
  const padding = CROP_PADDING * scale;

  const left = clampTo(Math.floor(page.x * scale - padding), picture.width);
  const top = clampTo(Math.floor(page.y * scale - padding), picture.height);
  const right = clampTo(Math.ceil((page.x + page.w) * scale + padding), picture.width);
  const bottom = clampTo(Math.ceil((page.y + page.h) * scale + padding), picture.height);

  if (right <= left || bottom <= top) return undefined;

  return { x: left, y: top, width: right - left, height: bottom - top };
}
