/**
 * @file workspace plugin — keys/escape.ts (skeleton stubs, implemented in its wave).
 */
import type { EscLayer, WorkspaceCtx } from "../types";

/**
 * Skeleton stub constant; implemented in its wave.
 *
 * @example
 * ```ts
 * void 0;
 * ```
 */
export const ESC_RANK: readonly EscLayer[] = [
  "palette",
  "contactSheet",
  "contextMenu",
  "noteEditor",
  "registry",
  "seriesPopover",
  "captureCard",
  "picker",
  "fileEdit",
  "codeEdit",
  "stepPopover",
  "selection"
];

/**
 * Skeleton stub for `addEscapeLayer`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _layer - The layer.
 * @param _close - The close.
 * @example
 * ```ts
 * addEscapeLayer();
 * ```
 */
export function addEscapeLayer(
  _ctx: WorkspaceCtx,
  _layer: EscLayer,
  _close: () => boolean
): () => void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `unwind`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * unwind();
 * ```
 */
export function unwind(_ctx: WorkspaceCtx): boolean {
  throw new Error("not implemented");
}
