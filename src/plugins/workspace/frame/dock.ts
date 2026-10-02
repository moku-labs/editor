/**
 * @file workspace plugin — frame/dock.ts (skeleton stubs, implemented in its wave).
 */
import type { FrameBox, FrameFit, PreviewCorner, RectBox } from "../types";

/**
 * Skeleton stub for `fitScale`; implemented in its wave.
 *
 * @param _slot - The slot.
 * @param _slot.w - The w.
 * @param _slot.h - The h.
 * @param _device - The device.
 * @param _device.w - The w.
 * @param _device.h - The h.
 * @param _fit - The fit.
 * @param _cap - The cap.
 * @example
 * ```ts
 * fitScale();
 * ```
 */
export function fitScale(
  _slot: { readonly w: number; readonly h: number },
  _device: { readonly w: number; readonly h: number },
  _fit: FrameFit,
  _cap: boolean
): number {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `centreBox`; implemented in its wave.
 *
 * @param _slot - The slot.
 * @param _size - The size.
 * @param _size.w - The w.
 * @param _size.h - The h.
 * @param _scale - The scale.
 * @example
 * ```ts
 * centreBox();
 * ```
 */
export function centreBox(
  _slot: RectBox,
  _size: { readonly w: number; readonly h: number },
  _scale: number
): { left: number; top: number } {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `clipInsets`; implemented in its wave.
 *
 * @param _box - The box.
 * @param _clip - The clip.
 * @example
 * ```ts
 * clipInsets();
 * ```
 */
export function clipInsets(
  _box: FrameBox,
  _clip: RectBox
): { top: number; right: number; bottom: number; left: number } {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `nearestCorner`; implemented in its wave.
 *
 * @param _point - The point.
 * @param _point.x - The x.
 * @param _point.y - The y.
 * @param _zone - The zone.
 * @example
 * ```ts
 * nearestCorner();
 * ```
 */
export function nearestCorner(
  _point: { readonly x: number; readonly y: number },
  _zone: RectBox
): PreviewCorner {
  throw new Error("not implemented");
}
