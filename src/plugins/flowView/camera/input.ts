/**
 * @file flowView plugin — camera/input.ts (skeleton stubs, implemented in its wave).
 */
import type { CameraIntent, CameraOp } from "./types";

/**
 * Skeleton stub for `wheelOp`; implemented in its wave.
 *
 * @param _event - The event.
 * @param _event.deltaX - The deltaX.
 * @param _event.deltaY - The deltaY.
 * @param _event.deltaMode - The deltaMode.
 * @param _event.shiftKey - The shiftKey.
 * @param _event.ctrlKey - The ctrlKey.
 * @param _event.metaKey - The metaKey.
 * @param _pointer - The pointer.
 * @param _pointer.x - The x.
 * @param _pointer.y - The y.
 * @param _viewHeight - The viewHeight.
 * @example
 * ```ts
 * wheelOp();
 * ```
 */
export function wheelOp(
  _event: {
    readonly deltaX: number;
    readonly deltaY: number;
    readonly deltaMode: number;
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
  },
  _pointer: { readonly x: number; readonly y: number },
  _viewHeight: number
): CameraOp {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `releaseIntent`; implemented in its wave.
 *
 * @param _moved - The moved.
 * @param _target - The target.
 * @param _key - The key.
 * @example
 * ```ts
 * releaseIntent();
 * ```
 */
export function releaseIntent(
  _moved: number,
  _target: "canvas" | "frame" | "lane" | "hub-head" | "card" | "note",
  _key: string | undefined
): CameraIntent | undefined {
  throw new Error("not implemented");
}
