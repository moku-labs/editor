/**
 * @file workspace plugin — Esc unwinding (design §4): layers in rank order (the palette and the
 * contact sheet are modals and come first), the latest registration of a layer is asked first,
 * and the first `close()` that returns true consumes the press: one Esc closes one thing.
 */
import type { EscLayer, WorkspaceCtx } from "../types";

/**
 * Esc layers in unwinding order.
 *
 * @example
 * ```ts
 * ESC_RANK.indexOf("palette"); // 0
 * ```
 */
export const ESC_RANK: readonly EscLayer[] = [
  "palette",
  "contactSheet",
  "contextMenu",
  "registry",
  "seriesPopover",
  "captureCard",
  "picker",
  "fileEdit",
  "codeEdit",
  "stepPopover",
  "reference",
  "selection"
];

/**
 * Registers a closer on a layer.
 *
 * @param ctx - Domain context of workspace.
 * @param layer - The layer.
 * @param close - Closes the thing and returns true, or returns false when nothing is open.
 * @returns Removes the closer.
 */
export function addEscapeLayer(
  ctx: Pick<WorkspaceCtx, "state">,
  layer: EscLayer,
  close: () => boolean
): () => void {
  const layers = ctx.state.keys.escape;
  let order = 0;
  for (const entry of layers) order = Math.max(order, entry.order);
  const entry = { layer, close, order: order + 1 };
  layers.push(entry);

  return () => {
    const index = layers.indexOf(entry);
    if (index !== -1) layers.splice(index, 1);
  };
}

/**
 * Handles one Esc press: asks the closers in rank order, latest first within a layer.
 *
 * @param ctx - Domain context of workspace.
 * @returns True when something closed.
 */
export function unwind(ctx: Pick<WorkspaceCtx, "state">): boolean {
  const entries = ctx.state.keys.escape.toSorted(
    (a, b) => ESC_RANK.indexOf(a.layer) - ESC_RANK.indexOf(b.layer) || b.order - a.order
  );
  return entries.some(entry => entry.close());
}
