/**
 * @file gameView plugin — the block and the card of an area pick (U9, A17), pure. The head is the
 * line the clipboard gets: `@moku area <w>×<h> · <flow node> · <N> elements · ref x,y w×h ·
 * <card path>`; then one line per group element in the one-line form (name, type, key,
 * `file:line`, reference rect), "+N more" past the cap, and the tail lines of a single element's
 * block (flow, game, device, restore, shot). The card adds the code of the first elements with a
 * source and the pictures.
 */
import type { PageRect, SceneNode } from "../../panels/shared/scene";
import type { ElementCode, StyleSource } from "../types";
import { flowNodeOf, rectText, sourceText, type TailFacts, tailLines } from "./block";
import { codeSections, fenced, fileName } from "./card";

/**
 * One element of the group with its source search result.
 */
export type AreaItem = { readonly node: SceneNode; readonly source: StyleSource | undefined };

/**
 * The code of one group element for the card.
 */
export type AreaCode = { readonly node: SceneNode; readonly code: ElementCode };

/**
 * Everything the area block prints: the area, the group and the tail facts.
 */
export type AreaFacts = TailFacts & {
  /** The area in device CSS px. */
  readonly area: PageRect;
  /** The area in the game's reference units; undefined when the scene is not calibrated (A17). */
  readonly refArea: PageRect | undefined;
  /** The group, at most 40, top to bottom then left to right. */
  readonly items: readonly AreaItem[];
  /** The elements of the group before the cap. */
  readonly total: number;
};

/**
 * How many elements the head names.
 *
 * @param total - The elements of the group.
 * @returns "no elements", "1 element", "12 elements".
 */
function countText(total: number): string {
  if (total === 0) return "no elements";
  return total === 1 ? "1 element" : `${total} elements`;
}

/**
 * The head of the block, the line the clipboard gets; a field that is not known is left out.
 *
 * @param facts - The area facts.
 * @param card - The card file, undefined when none was written.
 * @returns `@moku area <w>×<h> · <flow node> · <N> elements · ref x,y w×h · <card path>`.
 * @example
 * ```ts
 * areaHead(facts, ".moku/captures/area-f25.md");
 * // "@moku area 520×135 · board/awaitIntent · 2 elements · ref 30,45 520×135 · .moku/captures/area-f25.md"
 * ```
 */
export function areaHead(facts: AreaFacts, card: string | undefined): string {
  const { area, refArea } = facts;
  const fields = [
    `@moku area ${Math.round(area.w)}×${Math.round(area.h)}`,
    flowNodeOf(facts.position),
    countText(facts.total),
    refArea === undefined ? undefined : `ref ${rectText(refArea)}`,
    card
  ];
  return fields.filter(field => field !== undefined).join(" · ");
}

/**
 * The line of one group element: name and type, key, `file:line` and its reference rect.
 *
 * @param item - The element and its source.
 * @returns `- coinPill row · key coinPill · src/hud/Hud.tsx:2 · ref 235,74 290×76`.
 * @example
 * ```ts
 * itemLine({ node: homeNode, source: undefined }); // "- home button · key home · ref 40,52 120×120"
 * ```
 */
export function itemLine(item: AreaItem): string {
  const { node, source } = item;
  const fields = [
    `- ${node.name} ${node.type}`,
    node.key === undefined ? undefined : `key ${node.key}`,
    source === undefined ? undefined : sourceText(source),
    node.refRect === undefined ? undefined : `ref ${rectText(node.refRect)}`
  ];
  return fields.filter(field => field !== undefined).join(" · ");
}

/**
 * The block of an area: the head, one line per element, "+N more" past the cap, the tail lines.
 *
 * @param facts - The area facts.
 * @param card - The card file the head names, undefined for none.
 * @returns The block, one fact per line.
 * @example
 * ```ts
 * areaBlock(facts, ".moku/captures/area-f25.md").split("\n")[1]; // "- home button · key home · ref 40,52 120×120"
 * ```
 */
export function areaBlock(facts: AreaFacts, card: string | undefined): string {
  const more = facts.total - facts.items.length;
  const lines = [
    areaHead(facts, card),
    ...facts.items.map(item => itemLine(item)),
    more > 0 ? `+${more} more` : undefined,
    ...tailLines(facts)
  ];
  return lines.filter(entry => entry !== undefined).join("\n");
}

/**
 * The card file of an area: a heading with its size, the block in a text fence, the code of the
 * elements (each section names its element) and the pictures of the pick.
 *
 * @param block - The area block.
 * @param facts - The facts it was built from (the area and the pick's files).
 * @param codes - The code of the first elements with a source.
 * @returns The markdown text, ending with a newline.
 * @example
 * ```ts
 * areaCardText(block, facts, []).split("\n")[0]; // "# @moku area 520×135"
 * ```
 */
export function areaCardText(block: string, facts: AreaFacts, codes: readonly AreaCode[]): string {
  const { area, pick } = facts;
  const images = [
    pick?.crop === undefined ? undefined : `![area](${fileName(pick.crop)})`,
    pick?.full === undefined ? undefined : `![frame](${fileName(pick.full)})`
  ].filter(image => image !== undefined);
  const sections = [
    [`# @moku area ${Math.round(area.w)}×${Math.round(area.h)}`],
    fenced(block.split("\n"), "text"),
    ...codes.flatMap(({ node, code }) => codeSections(code, node.name)),
    ...(images.length === 0 ? [] : [images])
  ];
  return `${sections.map(section => section.join("\n")).join("\n\n")}\n`;
}
