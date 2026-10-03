/**
 * @file gameView plugin — the picker layer (F11): a transparent layer in gameView's overlay root
 * that takes pointer events only while picking (the iframe gets none then). Hover shows the box
 * of the element under the pointer; a click selects it. The render tree (renderView) is the
 * keyboard path to an element.
 */
import type { VNode } from "preact";
import { hoverAt, pickAt } from "../element/select";
import type { GameViewCtx } from "../types";

/**
 * Props of `PickerLayer`.
 */
export type PickerLayerProps = { readonly ctx: GameViewCtx };

/**
 * The picker layer.
 *
 * @param props - The gameView domain context.
 * @returns The layer.
 * @example
 * ```tsx
 * {picking && <PickerLayer ctx={ctx} />}
 * ```
 */
export function PickerLayer(props: PickerLayerProps): VNode {
  const { ctx } = props;
  return (
    <div
      data-part="picker"
      data-picking=""
      role="application"
      aria-label="Game element picker"
      onPointerMove={event => hoverAt(ctx, { x: event.clientX, y: event.clientY })}
      onPointerLeave={() => hoverAt(ctx)}
      onPointerUp={event => pickAt(ctx, { x: event.clientX, y: event.clientY })}
    />
  );
}
