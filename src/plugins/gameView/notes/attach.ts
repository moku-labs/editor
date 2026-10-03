/**
 * @file gameView plugin — notes/attach.ts (skeleton stubs, implemented in its wave).
 */
import type { GameViewCtx } from "../types";

/**
 * Skeleton stub for `listNotes`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * listNotes();
 * ```
 */
export function listNotes(_ctx: GameViewCtx): Promise<readonly { path: string; title: string }[]> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `attachCapture`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _capture - The capture.
 * @param _notePath - The notePath.
 * @example
 * ```ts
 * attachCapture();
 * ```
 */
export function attachCapture(
  _ctx: GameViewCtx,
  _capture: string,
  _notePath: string
): Promise<void> {
  throw new Error("not implemented");
}
