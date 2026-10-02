/**
 * @file flowView camera module — state factory.
 */
import type { CameraState } from "./types";

/**
 * Creates the camera slice: identity camera, no tween, follow off.
 *
 * @example
 * ```ts
 * createCameraState().follow; // false
 * ```
 */
export function createCameraState(): CameraState {
  throw new Error("not implemented");
}
