/**
 * @file gameView plugin — the Reference mode proxy layer (finding 17, D-27) inside gameView's
 * overlay root: `<div data-moku-proxies>` with one invisible `<div data-moku-proxy>` per placed
 * visible scene node at its bounds in device px, keyed by node id so a scene change updates the
 * proxies in place. Hover draws the picker box (OverlayRoot); a click completes a pick of the
 * node (round 2 R2: bookmark, shot, the reference block on the clipboard). A press that moves 4 px
 * or more drags an area instead (U9): the layer takes the pointer and the release picks the area.
 * The gesture handlers are the ones the Select picker layer uses too (`layerHandlers`).
 */
import type { VNode } from "preact";
import { useRef } from "preact/hooks";
import { pickProxy } from "../element/select";
import { hoverProxy } from "../reference/mode";
import { proxyList } from "../reference/proxies";
import { rectStyle } from "../stage/geometry";
import type { GameViewCtx, GameViewState } from "../types";
import { layerHandlers } from "./layer-handlers";

/**
 * Props of `ProxyLayer`.
 */
export type ProxyLayerProps = { readonly ctx: GameViewCtx };

/**
 * The proxies of a scene, back to front.
 */
type Proxies = ReturnType<typeof proxyList>;

/**
 * The proxies of the last render and the scene and flow node they were built for.
 */
type HeldProxies = {
  readonly scene: GameViewState["scene"];
  readonly node: string | undefined;
  readonly proxies: Proxies;
};

/**
 * The proxies to render. While an area drag runs, every move re-renders the layer for the
 * marquee only: the proxies built before the drag are kept while the scene and the flow node
 * stay the same. Outside a drag they are built again on each render.
 *
 * @param state - gameView state.
 * @returns The proxies, back to front.
 */
function useProxies(state: GameViewState): Proxies {
  const held = useRef<HeldProxies | undefined>(undefined);
  const { scene, reference, found, blocks } = state;
  const last = held.current;
  const isDragging = reference.press?.dragging === true;
  const isSameScene = last !== undefined && last.scene === scene && last.node === reference.node;
  if (isDragging && isSameScene) return last.proxies;

  const context = { node: reference.node, found, blocks };
  const proxies = scene === undefined ? [] : proxyList(scene, context);
  held.current = { scene, node: reference.node, proxies };
  return proxies;
}

/**
 * One invisible proxy per placed visible scene node in Reference mode: hover draws the picker
 * box, a click picks the node, a drag picks an area.
 *
 * @param props - The gameView domain context.
 * @returns The layer.
 */
export function ProxyLayer(props: ProxyLayerProps): VNode {
  const { ctx } = props;
  const proxies = useProxies(ctx.state);

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
