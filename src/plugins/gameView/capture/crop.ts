/**
 * @file gameView plugin — the crop of a pick (round 2 R2): the element's rect plus an 8 px margin,
 * cut from the `game.capture` picture in the tools page with a canvas. The rect is in device CSS
 * px; the picture has its own pixel size (the canvas of the game at the page's pixel ratio), so
 * the box is scaled by picture width / device width: the real pixel ratio of the shot, the preset
 * dpr when the game renders at it. Without a DOM or a 2D canvas there is no crop.
 */
import type { PageRect } from "../../panels/shared/scene";

/**
 * A box in picture pixels, whole numbers.
 */
export type PixelBox = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/**
 * The margin around the element in device CSS px.
 */
export const CROP_MARGIN = 8;

/**
 * The box of the crop in picture pixels: the rect grown by the margin, scaled by picture width /
 * device width, rounded outwards and clamped to the picture.
 *
 * @param rect - The element's rect in device CSS px.
 * @param device - The device size in CSS px (resolved for the orientation).
 * @param device.w - The device width.
 * @param picture - The picture's size in pixels.
 * @param picture.width - Its width.
 * @param picture.height - Its height.
 * @param margin - The margin in CSS px; 8 by default.
 * @returns The box, undefined when the picture or the device has no size or nothing is left.
 * @example
 * ```ts
 * cropBox({ x: 100, y: 200, w: 50, h: 20 }, { w: 393 }, { width: 1179, height: 2556 }); // { x: 276, y: 576, w: 198, h: 108 }
 * ```
 */
export function cropBox(
  rect: PageRect,
  device: { readonly w: number },
  picture: { readonly width: number; readonly height: number },
  margin = CROP_MARGIN
): PixelBox | undefined {
  if (device.w <= 0 || picture.width <= 0 || picture.height <= 0) return undefined;

  const scale = picture.width / device.w;
  const left = Math.max(0, Math.floor((rect.x - margin) * scale));
  const top = Math.max(0, Math.floor((rect.y - margin) * scale));
  const right = Math.min(picture.width, Math.ceil((rect.x + rect.w + margin) * scale));
  const bottom = Math.min(picture.height, Math.ceil((rect.y + rect.h + margin) * scale));
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Decodes a PNG data URL into an image element.
 *
 * @param image - The data URL.
 * @returns The decoded image.
 */
async function decodeImage(image: string): Promise<HTMLImageElement> {
  const picture = new Image();
  picture.src = image;
  await picture.decode();
  return picture;
}

/**
 * Cuts the element out of the captured picture: the crop box drawn into a canvas of its size,
 * at the picture's resolution.
 *
 * @param image - The PNG data URL of the whole frame.
 * @param rect - The element's rect in device CSS px.
 * @param device - The device size in CSS px.
 * @param device.w - The device width.
 * @returns The crop as a PNG data URL, undefined without a DOM, a 2D canvas or a box.
 * @throws {Error} When the picture does not decode.
 * @example
 * ```ts
 * const crop = await cropImage(shot.image, node.rect, { w: 393 }); // "data:image/png;base64,…" of the element plus 8 px
 * ```
 */
export async function cropImage(
  image: string,
  rect: PageRect,
  device: { readonly w: number }
): Promise<string | undefined> {
  if (globalThis.document === undefined || globalThis.Image === undefined) return undefined;

  const picture = await decodeImage(image);
  const size = { width: picture.naturalWidth, height: picture.naturalHeight };
  const box = cropBox(rect, device, size);
  if (box === undefined) return undefined;

  const canvas = document.createElement("canvas");
  canvas.width = box.w;
  canvas.height = box.h;
  const context = canvas.getContext("2d");
  if (context === null) return undefined;
  context.drawImage(picture, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return canvas.toDataURL("image/png");
}
