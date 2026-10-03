/**
 * @file gameView plugin — stage/label.ts (skeleton stubs, implemented in its wave).
 */
import type { PageRect } from "../../panels/shared/scene";

/**
 * Skeleton stub for `labelPlacement`; implemented in its wave.
 *
 * @param _box - The box.
 * @param _label - The label.
 * @param _label.w - The w.
 * @param _label.h - The h.
 * @param _device - The device.
 * @param _device.w - The w.
 * @param _device.h - The h.
 * @example
 * ```ts
 * labelPlacement();
 * ```
 */
export function labelPlacement(
  _box: PageRect,
  _label: { readonly w: number; readonly h: number },
  _device: { readonly w: number; readonly h: number }
): { x: number; y: number; flipped: boolean } {
  throw new Error("not implemented");
}
