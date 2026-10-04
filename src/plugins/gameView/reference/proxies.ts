/**
 * @file gameView plugin — Reference mode proxies (finding 17, D-27), pure: one proxy per placed
 * visible scene node with its rect in device px and the attributes Claude's DOM picker and
 * read_page see (`aria-label`, `title`, `data-moku-*`), layout-only nodes under the drawing ones,
 * paint order kept; and the one line "Copy reference" puts on the clipboard.
 */

import type { PageRect, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { isLayoutOnly } from "../../panels/shared/scene";
import type { StyleSource } from "../types";

/**
 * The attributes of one proxy element.
 */
export type ProxyAttributes = {
  readonly "aria-label": string;
  readonly title: string;
  readonly "data-moku-key": string | undefined;
  readonly "data-moku-name": string;
  readonly "data-moku-type": string;
  /** The ui path, or `entity:<id>`. */
  readonly "data-moku-path": string;
  /** "<flow>/<node>" of the game position. */
  readonly "data-moku-node": string | undefined;
  /** `file:line` of the key, from the source search results. */
  readonly "data-moku-source": string | undefined;
  /** The style identifier or call, else the nine-slice texture. */
  readonly "data-moku-style": string | undefined;
  /** `x y w h` in device px, rounded as the Element tab shows them. */
  readonly "data-moku-bounds": string;
};

/**
 * One proxy: the node id (its key in the layer), its rect and its attributes.
 */
export type Proxy = {
  readonly id: string;
  readonly rect: PageRect;
  readonly attributes: ProxyAttributes;
};

/**
 * What the proxies read besides the scene: the flow node and the source search results.
 */
export type ProxyContext = {
  readonly node: string | undefined;
  readonly found: ReadonlyMap<string, StyleSource>;
};

/**
 * A rect rounded as the Element tab shows it.
 *
 * @param rect - A rect.
 * @returns The four numbers.
 * @example
 * ```ts
 * rounded({ x: 428.5, y: 880.5, w: 223, h: 223 }); // [429, 881, 223, 223]
 * ```
 */
function rounded(rect: PageRect): readonly [number, number, number, number] {
  return [Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h)];
}

/**
 * The style a proxy names: the identifier or the call of the source search, else the nine-slice
 * texture of the node's style.
 *
 * @param node - The node.
 * @param source - Its source search result.
 * @returns The style text, or undefined.
 */
function styleName(node: SceneNode, source: StyleSource | undefined): string | undefined {
  if (source?.kind === "ident") return source.ref.name;
  if (source?.kind === "call") return source.call;
  const nineSlice = node.style?.nineSlice;
  return typeof nineSlice === "string" ? nineSlice : undefined;
}

/**
 * The proxy of one placed node.
 *
 * @param node - The node.
 * @param rect - Its rect.
 * @param context - The flow node and the source search results.
 * @returns The proxy.
 */
function proxyOf(node: SceneNode, rect: PageRect, context: ProxyContext): Proxy {
  const source = node.key === undefined ? undefined : context.found.get(node.key);
  return {
    id: node.id,
    rect,
    attributes: {
      "aria-label": node.name,
      title: `${node.name} · ${node.type}`,
      "data-moku-key": node.key,
      "data-moku-name": node.name,
      "data-moku-type": node.type,
      "data-moku-path": node.ref.kind === "ui" ? node.ref.path : `entity:${node.ref.id}`,
      "data-moku-node": context.node,
      "data-moku-source": source === undefined ? undefined : `${source.path}:${source.line}`,
      "data-moku-style": styleName(node, source),
      "data-moku-bounds": rounded(rect).join(" ")
    }
  };
}

/**
 * The proxies of a calibrated scene: one per placed visible node, the layout-only nodes first
 * (under every drawing node), each group in paint order (a later one is on top). An uncalibrated
 * scene has none: its rects are not device px.
 *
 * @param scene - The scene.
 * @param context - The flow node and the source search results.
 * @returns The proxies, back to front.
 * @example
 * ```ts
 * proxyList(scene, { node: "board/awaitIntent", found: new Map() })[0]?.id; // "ui:boardScreen"
 * ```
 */
export function proxyList(scene: SceneSnapshot, context: ProxyContext): readonly Proxy[] {
  if (!scene.calibrated) return [];
  const layout: Proxy[] = [];
  const drawing: Proxy[] = [];
  for (const id of scene.paintOrder) {
    const node = scene.nodes.get(id);
    if (node?.rect === undefined || !node.visible) continue;
    (isLayoutOnly(node) ? layout : drawing).push(proxyOf(node, node.rect, context));
  }
  return [...layout, ...drawing];
}

/**
 * The reference line of one node for the chat: `@moku <name> · <type> · <flow/node> ·
 * <file:line> · <x>,<y> <w>×<h>`; a part that is not known is left out.
 *
 * @param node - The node.
 * @param flowNode - "<flow>/<node>" of the game position.
 * @param source - The source search result of its key.
 * @returns The line.
 * @example
 * ```ts
 * referenceLine(coinPill, "board/awaitIntent", source); // "@moku coinPill · row · board/awaitIntent · src/hud/Hud.tsx:2 · 235,74 290×76"
 * ```
 */
export function referenceLine(
  node: SceneNode,
  flowNode: string | undefined,
  source: StyleSource | undefined
): string {
  const parts = [`@moku ${node.name}`, node.type];
  if (flowNode !== undefined) parts.push(flowNode);
  if (source !== undefined) parts.push(`${source.path}:${source.line}`);
  if (node.rect !== undefined) {
    const [x, y, w, h] = rounded(node.rect);
    parts.push(`${x},${y} ${w}×${h}`);
  }
  return parts.join(" · ");
}
