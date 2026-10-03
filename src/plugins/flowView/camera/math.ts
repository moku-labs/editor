/**
 * @file flowView plugin — camera/math.ts (skeleton stubs, implemented in its wave).
 */
import type { Camera, FlowViewConfig, Item, Rect } from "../types";
import type { ViewInsets, ViewSize } from "./types";

/**
 * Skeleton stub for `clampZoom`; implemented in its wave.
 *
 * @param _z - The z.
 * @param _config - The config.
 * @example
 * ```ts
 * clampZoom();
 * ```
 */
export function clampZoom(_z: number, _config: Readonly<FlowViewConfig>): number {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `zoomAt`; implemented in its wave.
 *
 * @param _cam - The cam.
 * @param _px - The px.
 * @param _py - The py.
 * @param _factor - The factor.
 * @param _config - The config.
 * @example
 * ```ts
 * zoomAt();
 * ```
 */
export function zoomAt(
  _cam: Camera,
  _px: number,
  _py: number,
  _factor: number,
  _config: Readonly<FlowViewConfig>
): Camera {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `fitRect`; implemented in its wave.
 *
 * @param _rect - The rect.
 * @param _view - The view.
 * @param _insets - The insets.
 * @param _pad - The pad.
 * @param _maxZ - The maxZ.
 * @param _config - The config.
 * @example
 * ```ts
 * fitRect();
 * ```
 */
export function fitRect(
  _rect: Rect,
  _view: ViewSize,
  _insets: ViewInsets,
  _pad: number,
  _maxZ: number,
  _config: Readonly<FlowViewConfig>
): Camera {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `defaultCamera`; implemented in its wave.
 *
 * @param _frame - The frame.
 * @param _current - The current.
 * @param _view - The view.
 * @param _insets - The insets.
 * @param _config - The config.
 * @example
 * ```ts
 * defaultCamera();
 * ```
 */
export function defaultCamera(
  _frame: Rect,
  _current: Rect | undefined,
  _view: ViewSize,
  _insets: ViewInsets,
  _config: Readonly<FlowViewConfig>
): Camera {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `focusCamera`; implemented in its wave.
 *
 * @param _item - The item.
 * @param _cam - The cam.
 * @param _view - The view.
 * @param _config - The config.
 * @example
 * ```ts
 * focusCamera();
 * ```
 */
export function focusCamera(
  _item: Item,
  _cam: Camera,
  _view: ViewSize,
  _config: Readonly<FlowViewConfig>
): Camera {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `followCamera`; implemented in its wave.
 *
 * @param _item - The item.
 * @param _cam - The cam.
 * @example
 * ```ts
 * followCamera();
 * ```
 */
export function followCamera(_item: Item, _cam: Camera): Camera {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `gridStep`; implemented in its wave.
 *
 * @param _z - The z.
 * @example
 * ```ts
 * gridStep();
 * ```
 */
export function gridStep(_z: number): number {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `logLerp`; implemented in its wave.
 *
 * @param _z0 - The z0.
 * @param _z1 - The z1.
 * @param _t - The t.
 * @example
 * ```ts
 * logLerp();
 * ```
 */
export function logLerp(_z0: number, _z1: number, _t: number): number {
  throw new Error("not implemented");
}
