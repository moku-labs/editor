/**
 * @file workspace plugin — pure frame geometry: the fit scale, the centred box, the clip insets in
 * local px, the nearest corner of a drop and the preview float rect. No DOM access here.
 */
import type { FrameBox, FrameFit, Insets, PreviewCorner, PreviewSize, RectBox } from "../types";

/**
 * Outer box of the preview float per size (design §5): S 150×280, M 280×540, L 340×660.
 *
 * @example
 * ```ts
 * PREVIEW_SIZES.M.w; // 280
 * ```
 */
export const PREVIEW_SIZES: Readonly<
  Record<PreviewSize, { readonly w: number; readonly h: number }>
> = {
  S: { w: 150, h: 280 },
  M: { w: 280, h: 540 },
  L: { w: 340, h: 660 }
};

/**
 * Margin between the preview float and its zone edge, in px.
 */
export const PREVIEW_MARGIN = 12;

/**
 * Insets with every side present.
 */
export type FullInsets = { top: number; right: number; bottom: number; left: number };

/**
 * True for a size with no area: a zero or negative width or height.
 *
 * @param size - The size.
 * @param size.w - Width.
 * @param size.h - Height.
 * @returns Whether the size is empty.
 * @example
 * ```ts
 * isEmpty({ w: 393, h: 0 }); // true
 * ```
 */
function isEmpty(size: { readonly w: number; readonly h: number }): boolean {
  return size.w <= 0 || size.h <= 0;
}

/**
 * The scale of the device in a slot: `fit` = the smaller ratio (capped at 1 for the stage),
 * `actual` = 1. An empty slot or device gives 0.
 *
 * @param slot - Slot size in tools-page px.
 * @param slot.w - Slot width.
 * @param slot.h - Slot height.
 * @param device - Device size in game CSS px.
 * @param device.w - Device width.
 * @param device.h - Device height.
 * @param fit - fit or actual.
 * @param cap - Cap the fit scale at 1 (the stage does, the preview does not).
 * @returns The scale.
 * @example
 * ```ts
 * fitScale({ w: 393, h: 426 }, { w: 393, h: 852 }, "fit", true); // 0.5
 * ```
 */
export function fitScale(
  slot: { readonly w: number; readonly h: number },
  device: { readonly w: number; readonly h: number },
  fit: FrameFit,
  cap: boolean
): number {
  if (fit === "actual") return 1;
  if (isEmpty(slot) || isEmpty(device)) return 0;

  const scale = Math.min(slot.w / device.w, slot.h / device.h);
  return cap ? Math.min(scale, 1) : scale;
}

/**
 * The top-left corner of the scaled device centred in the slot.
 *
 * @param slot - Slot rect in tools-page px.
 * @param size - Device size in game CSS px.
 * @param size.w - Device width.
 * @param size.h - Device height.
 * @param scale - The scale.
 * @returns Left and top in tools-page px.
 * @example
 * ```ts
 * centreBox({ left: 0, top: 0, width: 400, height: 900 }, { w: 393, h: 852 }, 1); // { left: 3.5, top: 24 }
 * ```
 */
export function centreBox(
  slot: RectBox,
  size: { readonly w: number; readonly h: number },
  scale: number
): { left: number; top: number } {
  return {
    left: slot.left + (slot.width - size.w * scale) / 2,
    top: slot.top + (slot.height - size.h * scale) / 2
  };
}

/**
 * An overflow in page px as a clip side in local px (never negative).
 *
 * @param pagePx - The overflow in tools-page px (negative = none).
 * @param scale - The frame scale (> 0).
 * @returns The side in local px.
 * @example
 * ```ts
 * toLocal(20, 0.5); // 40
 * ```
 */
function toLocal(pagePx: number, scale: number): number {
  return Math.max(0, pagePx) / scale;
}

/**
 * The `clip-path: inset()` sides that keep the frame inside the clip rect, in the frame's local
 * px (page px divided by the scale). A zero scale clips nothing.
 *
 * @param box - The frame box in tools-page px.
 * @param clip - The clip rect in tools-page px.
 * @returns Insets in local px, never negative.
 * @example
 * ```ts
 * clipInsets(
 *   { left: 0, top: 0, width: 400, height: 800, scale: 0.5, docked: "stage" },
 *   { left: 0, top: 20, width: 400, height: 760 }
 * ); // { top: 40, right: 0, bottom: 40, left: 0 }
 * ```
 */
export function clipInsets(box: FrameBox, clip: RectBox): FullInsets {
  if (box.scale <= 0) return { top: 0, right: 0, bottom: 0, left: 0 };

  return {
    top: toLocal(clip.top - box.top, box.scale),
    right: toLocal(box.left + box.width - (clip.left + clip.width), box.scale),
    bottom: toLocal(box.top + box.height - (clip.top + clip.height), box.scale),
    left: toLocal(clip.left - box.left, box.scale)
  };
}

/**
 * A clip side this deep (local px) cuts the screen: the corners on it are not the device's own.
 */
const CUT = 0.5;

/**
 * The `clip-path` of the docked frame: the clip insets, and the screen's rounded corners (round
 * DeviceSpec.radius). Both are in the frame's local px, so the transform shows the radius as
 * `radius × scale` on screen. A corner on a cut side stays square: only the device's own corners
 * are round.
 *
 * @param clip - The clip insets in local px (`clipInsets`).
 * @param radius - The screen corner radius in device CSS px.
 * @returns The `inset(…)` value.
 * @example
 * ```ts
 * clipPathOf({ top: 0, right: 0, bottom: 0, left: 0 }, 55); // "inset(0px 0px 0px 0px round 55px 55px 55px 55px)"
 * clipPathOf({ top: 40, right: 0, bottom: 0, left: 0 }, 30); // "inset(40px 0px 0px 0px round 0px 0px 30px 30px)"
 * ```
 */
export function clipPathOf(clip: FullInsets, radius: number): string {
  const sides = `${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px`;
  const round = (a: number, b: number): number => (a < CUT && b < CUT ? radius : 0);
  const corners = [
    round(clip.top, clip.left),
    round(clip.top, clip.right),
    round(clip.bottom, clip.right),
    round(clip.bottom, clip.left)
  ];
  if (corners.every(corner => corner <= 0)) return `inset(${sides})`;

  const radii = corners.map(corner => `${corner}px`).join(" ");
  return `inset(${sides} round ${radii})`;
}

/**
 * The zone corner nearest to a point (the quadrant it falls in).
 *
 * @param point - A point in tools-page px (the centre of the dropped float).
 * @param point.x - Horizontal position.
 * @param point.y - Vertical position.
 * @param zone - The zone rect.
 * @returns The corner.
 * @example
 * ```ts
 * nearestCorner({ x: 10, y: 10 }, { left: 0, top: 0, width: 800, height: 600 }); // "top-left"
 * ```
 */
export function nearestCorner(
  point: { readonly x: number; readonly y: number },
  zone: RectBox
): PreviewCorner {
  const top = point.y < zone.top + zone.height / 2;
  const left = point.x < zone.left + zone.width / 2;
  if (top) return left ? "top-left" : "top-right";
  return left ? "bottom-left" : "bottom-right";
}

/**
 * Every side of insets given as an object or a function; missing sides are 0.
 *
 * @param insets - Zone insets, a function that reads them, or undefined.
 * @returns The four sides.
 * @example
 * ```ts
 * resolveInsets({ bottom: 56 }); // { top: 0, right: 0, bottom: 56, left: 0 }
 * ```
 */
export function resolveInsets(insets: Insets | (() => Insets) | undefined): FullInsets {
  const value = typeof insets === "function" ? insets() : insets;
  return {
    top: value?.top ?? 0,
    right: value?.right ?? 0,
    bottom: value?.bottom ?? 0,
    left: value?.left ?? 0
  };
}

/**
 * A float never scales below this height (the height of S) while the zone has the room.
 */
const MIN_FLOAT_HEIGHT = PREVIEW_SIZES.S.h;

/**
 * The float size that fits the room of the zone. A size that fits stays. A bigger one scales
 * down with its aspect kept, to whole px. Below the height of S it stops: the size at that height
 * is clipped to the room instead, so the float always fits the zone.
 *
 * @param size - The chosen size.
 * @param size.w - Its width.
 * @param size.h - Its height.
 * @param room - The room inside the zone margins and insets (never negative).
 * @param room.w - Room width.
 * @param room.h - Room height.
 * @returns The size to draw.
 * @example
 * ```ts
 * fitFloat(PREVIEW_SIZES.M, { w: 172, h: 776 }); // { w: 172, h: 331 }
 * fitFloat(PREVIEW_SIZES.S, { w: 108, h: 776 }); // { w: 108, h: 280 }
 * ```
 */
function fitFloat(
  size: { readonly w: number; readonly h: number },
  room: { readonly w: number; readonly h: number }
): { w: number; h: number } {
  if (size.w <= room.w && size.h <= room.h) return { w: size.w, h: size.h };

  const scale = Math.min(room.w / size.w, room.h / size.h);
  const scaled = { w: Math.floor(size.w * scale), h: Math.floor(size.h * scale) };
  const floor = Math.min(size.h, MIN_FLOAT_HEIGHT);
  if (scaled.h >= floor) return scaled;

  const atFloor = { w: Math.floor((size.w * floor) / size.h), h: floor };
  return { w: Math.min(atFloor.w, room.w), h: Math.min(atFloor.h, room.h) };
}

/**
 * The preview float rect: in the chosen corner of the zone, PREVIEW_MARGIN plus the zone insets
 * away from its edges, and always inside them. A size the zone has no room for scales down (see
 * `fitFloat`), so the float never runs past the zone, for example over the rail next to a wide
 * Inspector drawer in the 480 px pane.
 *
 * @param zone - The zone rect in tools-page px.
 * @param insets - The zone insets.
 * @param corner - The corner.
 * @param size - The chosen float size.
 * @param size.w - Float width.
 * @param size.h - Float height.
 * @returns The float rect.
 * @example
 * ```ts
 * const zone = { left: 0, top: 0, width: 800, height: 600 };
 * const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
 * floatRect(zone, noInsets, "bottom-right", PREVIEW_SIZES.S); // { left: 638, top: 308, width: 150, height: 280 }
 * floatRect(zone, { ...noInsets, right: 680 }, "bottom-right", PREVIEW_SIZES.S); // { left: 12, top: 308, width: 96, height: 280 }
 * ```
 */
export function floatRect(
  zone: RectBox,
  insets: FullInsets,
  corner: PreviewCorner,
  size: { readonly w: number; readonly h: number }
): RectBox {
  // The room inside the margins and the insets, and the size that fits it.
  const minLeft = zone.left + PREVIEW_MARGIN + insets.left;
  const minTop = zone.top + PREVIEW_MARGIN + insets.top;
  const maxRight = zone.left + zone.width - PREVIEW_MARGIN - insets.right;
  const maxBottom = zone.top + zone.height - PREVIEW_MARGIN - insets.bottom;
  const room = { w: Math.max(0, maxRight - minLeft), h: Math.max(0, maxBottom - minTop) };
  const { w, h } = fitFloat(size, room);

  // The corner, kept inside the room.
  const left = corner.endsWith("left") ? minLeft : Math.max(minLeft, maxRight - w);
  const top = corner.startsWith("top") ? minTop : Math.max(minTop, maxBottom - h);
  return { left, top, width: w, height: h };
}
