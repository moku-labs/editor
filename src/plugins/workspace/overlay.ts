/**
 * @file workspace plugin — overlay.ts (skeleton stubs, implemented in its wave).
 */

import type { Manifest } from "../registry/protocol";
import type { RunOrigin, WorkspaceCtx } from "./types";

/**
 * Skeleton stub for `setOverlayInGame`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _on - The on.
 * @param _origin - The origin.
 * @example
 * ```ts
 * setOverlayInGame();
 * ```
 */
export function setOverlayInGame(
  _ctx: WorkspaceCtx,
  _on: boolean,
  _origin: RunOrigin
): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `reapplyOverlay`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _manifest - The manifest.
 * @example
 * ```ts
 * reapplyOverlay();
 * ```
 */
export function reapplyOverlay(_ctx: WorkspaceCtx, _manifest: Manifest | undefined): void {
  throw new Error("not implemented");
}
