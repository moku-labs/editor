/**
 * @file gameView plugin — Reference mode proxies (finding 17, D-27), pure: one proxy per placed
 * visible scene node with its rect in device px and the attributes Claude's DOM picker and
 * read_page see (`aria-label`, `title`, `data-moku-*`, round 2 adds the frame, the reference
 * bounds and the place of the style block), layout-only nodes under the drawing ones, paint order
 * kept.
 */

import type { PageRect, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { isLayoutOnly } from "../../panels/shared/scene";
import { stylePathOf, writtenStyle } from "../element/style-path";
import type { BlockAt, StyleSource } from "../types";
import { sourceText } from "./block";

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
  /** `file:line` of the key, from the index answers. */
  readonly "data-moku-source": string | undefined;
  /** The style identifier or call, else the nine-slice texture. */
  readonly "data-moku-style": string | undefined;
  /** `file:line` of the style block of an identifier, or of the style call. */
  readonly "data-moku-style-source": string | undefined;
  /** `x y w h` in device px, rounded as the Element tab shows them. */
  readonly "data-moku-bounds": string;
  /** `x y w h` in reference units (SceneNode.refRect), rounded. */
  readonly "data-moku-ref-bounds": string | undefined;
  /** The frame of the scene the proxy was drawn from. */
  readonly "data-moku-frame": string;
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
 * What the proxies read besides the scene: the flow node, the index answers and the
 * style blocks found.
 */
export type ProxyContext = {
  readonly node: string | undefined;
  readonly found: ReadonlyMap<string, StyleSource>;
  readonly blocks: ReadonlyMap<string, BlockAt>;
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
 * The style a proxy names: the identifier or the call of the index answer, else the nine-slice
 * texture of the node's style.
 *
 * @param node - The node.
 * @param source - Its index answer.
 * @returns The style text, or undefined.
 */
function styleName(node: SceneNode, source: StyleSource | undefined): string | undefined {
  const nineSlice = node.style?.nineSlice;
  return writtenStyle(source) ?? (typeof nineSlice === "string" ? nineSlice : undefined);
}

/**
 * Where the style of a node is written: the block of its identifier, or its call.
 *
 * @param source - Its index answer.
 * @param block - The block found for its key.
 * @returns `file:line`, or undefined.
 */
function styleSource(
  source: StyleSource | undefined,
  block: BlockAt | undefined
): string | undefined {
  if (source?.kind === "call") return `${stylePathOf(source)}:${source.callLine}`;
  if (source?.kind === "ident" && block !== undefined) return `${block.path}:${block.line}`;
  return undefined;
}

/**
 * The proxy of one placed node.
 *
 * @param node - The node.
 * @param rect - Its rect.
 * @param context - The flow node, the index answers and the style blocks.
 * @param frame - The frame of the scene.
 * @returns The proxy.
 */
function proxyOf(node: SceneNode, rect: PageRect, context: ProxyContext, frame: number): Proxy {
  const source = node.key === undefined ? undefined : context.found.get(node.key);
  const block = node.key === undefined ? undefined : context.blocks.get(node.key);
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
      "data-moku-source": source === undefined ? undefined : sourceText(source),
      "data-moku-style": styleName(node, source),
      "data-moku-style-source": styleSource(source, block),
      "data-moku-bounds": rounded(rect).join(" "),
      "data-moku-ref-bounds":
        node.refRect === undefined ? undefined : rounded(node.refRect).join(" "),
      "data-moku-frame": String(frame)
    }
  };
}

/**
 * The proxies of a calibrated scene: one per placed visible node, the layout-only nodes first
 * (under every drawing node), each group in paint order (a later one is on top). An uncalibrated
 * scene has none: its rects are not device px.
 *
 * @param scene - The scene.
 * @param context - The flow node, the index answers and the style blocks.
 * @returns The proxies, back to front.
 * @example
 * ```ts
 * proxyList(scene, { node: "board/awaitIntent", found: new Map(), blocks: new Map() })[0]?.id; // "ui:boardScreen"
 * ```
 */
export function proxyList(scene: SceneSnapshot, context: ProxyContext): readonly Proxy[] {
  if (!scene.calibrated) return [];
  const layout: Proxy[] = [];
  const drawing: Proxy[] = [];
  for (const id of scene.paintOrder) {
    const node = scene.nodes.get(id);
    if (node?.rect === undefined || !node.visible) continue;
    (isLayoutOnly(node) ? layout : drawing).push(proxyOf(node, node.rect, context, scene.frame));
  }
  return [...layout, ...drawing];
}
