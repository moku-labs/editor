/**
 * @file flowView camera module — state factory.
 */
import type { CameraState } from "./types";

/**
 * Creates the camera slice: identity camera, no tween, follow off, no viewport yet, no selection
 * waiting for the first measure.
 *
 * @returns The camera state.
 */
export function createCameraState(): CameraState {
  return {
    cam: { x: 0, y: 0, z: 1 },
    anim: undefined,
    follow: false,
    viewport: { w: 0, h: 0 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    initialised: false,
    frameSelection: false
  };
}
