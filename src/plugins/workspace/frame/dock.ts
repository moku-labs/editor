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
  if (slot.w <= 0 || slot.h <= 0 || device.w <= 0 || device.h <= 0) return 0;

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
 * resolveInsets(() => ({ bottom: stripOpen ? 208 : 56 }));
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
 * The preview float rect: in the chosen corner of the zone, PREVIEW_MARGIN plus the zone insets
 * away from its edges.
 *
 * @param zone - The zone rect in tools-page px.
 * @param insets - The zone insets.
 * @param corner - The corner.
 * @param size - The float size.
 * @param size.w - Float width.
 * @param size.h - Float height.
 * @returns The float rect.
 * @example
 * ```ts
 * floatRect(zoneRect, resolveInsets(zone.insets), "bottom-right", PREVIEW_SIZES.S);
 * ```
 */
export function floatRect(
  zone: RectBox,
  insets: FullInsets,
  corner: PreviewCorner,
  size: { readonly w: number; readonly h: number }
): RectBox {
  const left = corner.endsWith("left")
    ? zone.left + PREVIEW_MARGIN + insets.left
    : zone.left + zone.width - PREVIEW_MARGIN - insets.right - size.w;
  const top = corner.startsWith("top")
    ? zone.top + PREVIEW_MARGIN + insets.top
    : zone.top + zone.height - PREVIEW_MARGIN - insets.bottom - size.h;
  return { left, top, width: size.w, height: size.h };
}
