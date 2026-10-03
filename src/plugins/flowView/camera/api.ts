/**
 * @file flowView camera module — the camera namespace of the api.
 */
import type { FlowCtx } from "../types";
import type { CameraApi } from "./types";

/**
 * Creates the camera api.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * createCameraApi(ctx).zoomBy(1.25);
 * ```
 */
export function createCameraApi(_ctx: FlowCtx): CameraApi {
  throw new Error("not implemented");
}
