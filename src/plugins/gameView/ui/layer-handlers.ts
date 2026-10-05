/**
 * @file gameView plugin — the pointer handlers of the area gesture (U9, captures-by-day U4), one
 * factory for both layers that take the pointer over the game: the Reference mode proxy layer and
 * the Select picker layer. A press, a move past 4 px that starts the drag (then the layer holds
 * the pointer), the release and a cancel; a release without a drag is a click.
 */
import type { JSX } from "preact";
import { dropPress, moveArea, type PointerAt, pressArea, releaseArea } from "../reference/gesture";
import { messageOf } from "../report";
import type { GameViewCtx } from "../types";

/**
 * A pointer event of a layer.
 */
type LayerEvent = JSX.TargetedPointerEvent<HTMLDivElement>;

/**
 * The four pointer handlers a layer spreads onto its element.
 */
export type LayerHandlers = {
  readonly onPointerDown: (event: LayerEvent) => void;
  readonly onPointerMove: (event: LayerEvent) => void;
  readonly onPointerUp: (event: LayerEvent) => void;
  readonly onPointerCancel: (event: LayerEvent) => void;
};

/**
 * The pointer of an event: its id and its client point.
 *
 * @param event - A pointer event.
 * @returns The pointer the gesture reads.
 */
function pointerOf(event: PointerEvent): PointerAt {
  return { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
}

/**
 * Makes the layer hold the pointer, so the drag goes on past its edge and the element under the
 * release does not pick. A browser that refuses (a pointer it no longer tracks) leaves the drag
 * without capture.
 *
 * @param ctx - Domain context of gameView.
 * @param layer - The layer element.
 * @param pointerId - The pointer.
 */
function holdPointer(ctx: GameViewCtx, layer: Element, pointerId: number): void {
  try {
    layer.setPointerCapture(pointerId);
  } catch (error) {
    ctx.log.debug("gameView: pointer capture refused", { message: messageOf(error) });
  }
}

/**
 * The pointer handlers of a layer: a main-button press, a move that may start the area drag (then
 * the layer holds the pointer), the release (a drag picks the area) and a cancel. A release that
 * ends no drag is a click and goes to `onClick`.
 *
 * @param ctx - Domain context of gameView.
 * @param onClick - What a click does at its point; omitted where the targets pick themselves (the
 *   Reference mode proxies).
 * @returns The four handlers.
 */
export function layerHandlers(ctx: GameViewCtx, onClick?: (at: PointerAt) => void): LayerHandlers {
  return {
    onPointerDown: event => {
      if (event.button === 0) pressArea(ctx, pointerOf(event));
    },
    onPointerMove: event => {
      const started = moveArea(ctx, pointerOf(event), event.buttons !== 0);
      if (started) holdPointer(ctx, event.currentTarget, event.pointerId);
    },
    onPointerUp: event => {
      const at = pointerOf(event);
      if (releaseArea(ctx, at)) onClick?.(at);
    },
    onPointerCancel: event => dropPress(ctx, event.pointerId)
  };
}
