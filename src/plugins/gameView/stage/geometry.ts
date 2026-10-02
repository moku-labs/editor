/**
 * @file gameView plugin — stage/geometry.ts (skeleton stubs, implemented in its wave).
 */
import type { DeviceSize } from "../../workspace/types";

/**
 * Skeleton stub for `fitScale`; implemented in its wave.
 *
 * @param _stage - The stage.
 * @param _stage.w - The w.
 * @param _stage.h - The h.
 * @param _device - The device.
 * @param _desktop - The desktop.
 * @example
 * ```ts
 * fitScale();
 * ```
 */
export function fitScale(
  _stage: { readonly w: number; readonly h: number },
  _device: DeviceSize,
  _desktop: boolean
): number {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `slotSize`; implemented in its wave.
 *
 * @param _device - The device.
 * @param _scale - The scale.
 * @example
 * ```ts
 * slotSize();
 * ```
 */
export function slotSize(_device: DeviceSize, _scale: number): { w: number; h: number } {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `safeBands`; implemented in its wave.
 *
 * @param _device - The device.
 * @example
 * ```ts
 * safeBands();
 * ```
 */
export function safeBands(
  _device: DeviceSize
): readonly { readonly side: "top" | "right" | "bottom" | "left"; readonly size: number }[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `hasIsland`; implemented in its wave.
 *
 * @param _kind - The kind.
 * @param _safeTop - The safeTop.
 * @example
 * ```ts
 * hasIsland();
 * ```
 */
export function hasIsland(_kind: "phone" | "tablet" | "desktop", _safeTop: number): boolean {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `hasHomeBar`; implemented in its wave.
 *
 * @param _kind - The kind.
 * @param _safeBottom - The safeBottom.
 * @example
 * ```ts
 * hasHomeBar();
 * ```
 */
export function hasHomeBar(_kind: "phone" | "tablet" | "desktop", _safeBottom: number): boolean {
  throw new Error("not implemented");
}
