/**
 * @file gameView plugin — the Reference mode proxy layer (finding 17, D-27) inside gameView's
 * overlay root: `<div data-moku-proxies>` with one invisible `<div data-moku-proxy>` per placed
 * visible scene node at its bounds in device px, keyed by node id so a scene change updates the
 * proxies in place. Hover draws the picker box (OverlayRoot); a click completes a pick of the
 * node (round 2 R2: bookmark, shot, the reference block on the clipboard). A press that moves 4 px
 * or more drags an area instead (U9): the layer takes the pointer and the release picks the area.
 */
import type { JSX, VNode } from "preact";
import { pickProxy } from "../element/select";
import { dropPress, moveArea, type PointerAt, pressArea, releaseArea } from "../reference/gesture";
import { hoverProxy } from "../reference/mode";
import { proxyList } from "../reference/proxies";
import { messageOf } from "../report";
import { rectStyle } from "../stage/geometry";
import type { GameViewCtx } from "../types";

/**
 * Props of `ProxyLayer`.
 */
export type ProxyLayerProps = { readonly ctx: GameViewCtx };

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
 * Makes the layer hold the pointer, so the drag goes on past its edge and the proxy under the
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
 * A pointer event of the layer.
 */
type LayerEvent = JSX.TargetedPointerEvent<HTMLDivElement>;

/**
 * The pointer handlers of the layer (U9): a main-button press, a move that may start the drag
 * (then the layer holds the pointer), the release and a cancel.
 *
 * @param ctx - Domain context of gameView.
 * @returns The four handlers.
 */
function layerHandlers(ctx: GameViewCtx): {
  readonly onPointerDown: (event: LayerEvent) => void;
  readonly onPointerMove: (event: LayerEvent) => void;
  readonly onPointerUp: (event: LayerEvent) => void;
  readonly onPointerCancel: (event: LayerEvent) => void;
} {
  return {
    onPointerDown: event => {
      if (event.button === 0) pressArea(ctx, pointerOf(event));
    },
    onPointerMove: event => {
      const started = moveArea(ctx, pointerOf(event), event.buttons !== 0);
      if (started) holdPointer(ctx, event.currentTarget, event.pointerId);
    },
    onPointerUp: event => releaseArea(ctx, pointerOf(event)),
    onPointerCancel: event => dropPress(ctx, event.pointerId)
  };
}

/**
 * The proxy layer.
 *
 * @param props - The gameView domain context.
 * @returns The layer.
 */
export function ProxyLayer(props: ProxyLayerProps): VNode {
  const { ctx } = props;
  const { scene, reference, found, blocks } = ctx.state;
  const context = { node: reference.node, found, blocks };
  const proxies = scene === undefined ? [] : proxyList(scene, context);

  return (
    <div data-moku-proxies="" onPointerLeave={() => hoverProxy(ctx)} {...layerHandlers(ctx)}>
      {proxies.map(proxy => (
        <div
          key={proxy.id}
          data-moku-proxy=""
          role="img"
          {...proxy.attributes}
          style={rectStyle(proxy.rect)}
          onPointerEnter={() => hoverProxy(ctx, proxy.id)}
          onPointerUp={() => void pickProxy(ctx, proxy.id)}
        />
      ))}
    </div>
  );
}
