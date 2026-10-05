/**
 * @file gameView plugin — the picker layer (F11): a transparent layer in gameView's overlay root
 * that takes pointer events only while picking (the iframe gets none then). Hover shows the box
 * of the element under the pointer; a click selects it. A press that moves 4 px or more drags an
 * area instead, with the gesture of the Reference mode proxy layer (captures-by-day U4): the
 * marquee follows, the hover box stays, the release picks the area and turns the picker off, Esc
 * cancels the drag. The render tree (renderView) is the keyboard path to an element.
 */
import type { VNode } from "preact";
import { hoverAt, pickAt } from "../element/select";
import type { GameViewCtx } from "../types";
import { layerHandlers } from "./layer-handlers";

/**
 * Props of `PickerLayer`.
 */
export type PickerLayerProps = { readonly ctx: GameViewCtx };

/**
 * The picker layer.
 *
 * @param props - The gameView domain context.
 * @returns The layer.
 */
export function PickerLayer(props: PickerLayerProps): VNode {
  const { ctx } = props;
  const gesture = layerHandlers(ctx, at => void pickAt(ctx, at));
  return (
    <div
      data-part="picker"
      data-picking=""
      role="application"
      aria-label="Game element picker"
      {...gesture}
      onPointerMove={event => {
        gesture.onPointerMove(event);
        hoverAt(ctx, { x: event.clientX, y: event.clientY });
      }}
      onPointerLeave={() => hoverAt(ctx)}
    />
  );
}
