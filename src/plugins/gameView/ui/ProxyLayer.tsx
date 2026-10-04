/**
 * @file gameView plugin — the Reference mode proxy layer (finding 17, D-27) inside gameView's
 * overlay root: `<div data-moku-proxies>` with one invisible `<div data-moku-proxy>` per placed
 * visible scene node at its bounds in device px, keyed by node id so a scene change updates the
 * proxies in place. Hover draws the picker box (OverlayRoot).
 */
import type { VNode } from "preact";
import { hoverProxy } from "../reference/mode";
import { proxyList } from "../reference/proxies";
import { rectStyle } from "../stage/geometry";
import type { GameViewCtx } from "../types";

/**
 * Props of `ProxyLayer`.
 */
export type ProxyLayerProps = { readonly ctx: GameViewCtx };

/**
 * The proxy layer.
 *
 * @param props - The gameView domain context.
 * @returns The layer.
 */
export function ProxyLayer(props: ProxyLayerProps): VNode {
  const { ctx } = props;
  const { scene, reference, found } = ctx.state;
  const proxies = scene === undefined ? [] : proxyList(scene, { node: reference.node, found });

  return (
    <div data-moku-proxies="" onPointerLeave={() => hoverProxy(ctx)}>
      {proxies.map(proxy => (
        <div
          key={proxy.id}
          data-moku-proxy=""
          role="img"
          {...proxy.attributes}
          style={rectStyle(proxy.rect)}
          onPointerEnter={() => hoverProxy(ctx, proxy.id)}
        />
      ))}
    </div>
  );
}
