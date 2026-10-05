/**
 * @file gameView plugin — the block and the card of an area pick (U9, A17, captures-by-day U5),
 * pure. The head is the line the clipboard gets: `@moku area <w>×<h> · <flow node> · <N>
 * elements · ref x,y w×h · <card path>`; then one line per group element (name, type, key, text,
 * `file:line`, px bounds, reference rect) with its child tree indented two spaces per level,
 * "+N more" past the caps, one `layout:` line per parent chain, the `partly in the area:` line,
 * and the tail lines of a single element's block (flow, game, device, restore, shot). The card
 * adds the code of every element with a source, the definitions of the components the area
 * uses and the pictures.
 */
import type { PageRect, SceneNode } from "../../panels/shared/scene";
import type { ElementCode, StyleSource } from "../types";
import type { AreaComponent } from "./area-components";
import type { AreaBranch, AreaChild } from "./area-tree";
import { flowNodeOf, rectText, sourceText, type TailFacts, tailLines } from "./block";
import { codeSections, fenced, fileName, snippetSection } from "./card";

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
  /** The text and the child tree of each group element, by node id (U5). */
  readonly branches: ReadonlyMap<string, AreaBranch>;
  /** One layout line per parent chain of the group, without the `layout: ` label (U5). */
  readonly layouts: readonly string[];
  /** The nodes partly in the area, largest overlap first (U5). */
  readonly partly: readonly SceneNode[];
};

/**
 * Joins the known fields of a line with " · ".
 *
 * @param fields - The fields, undefined for unknown ones.
 * @returns The line.
 * @example
 * ```ts
 * joined(["- home button", undefined, "key home"]); // "- home button · key home"
 * ```
 */
function joined(fields: readonly (string | undefined)[]): string {
  return fields.filter(field => field !== undefined).join(" · ");
}

/**
 * The text field of a line.
 *
 * @param text - The short text, undefined for none.
 * @returns `text "…"`, or undefined.
 * @example
 * ```ts
 * textField("1 250"); // 'text "1 250"'
 * ```
 */
function textField(text: string | undefined): string | undefined {
  return text === undefined ? undefined : `text "${text}"`;
}

/**
 * The px bounds field of a line: game page CSS px, as a single element's `bounds:`.
 *
 * @param node - The node.
 * @returns "235,74 290×76 px", undefined for an unplaced node.
 */
function pxField(node: SceneNode): string | undefined {
  return node.rect === undefined ? undefined : `${rectText(node.rect)} px`;
}

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
 * areaHead(facts, ".moku/captures/2026-10-05/area-f25.md");
 * // "@moku area 520×135 · board/awaitIntent · 2 elements · ref 30,45 520×135 · .moku/captures/2026-10-05/area-f25.md"
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
 * The line of one group element: name and type, key, text, `file:line`, its px bounds and its
 * reference rect.
 *
 * @param item - The element and its source.
 * @param text - The text it shows, undefined for none.
 * @returns `- coinPill row · key coinPill · src/hud/Hud.tsx:2 · 235,74 290×76 px · ref 235,74 290×76`.
 * @example
 * ```ts
 * itemLine({ node: homeNode, source: undefined }); // "- home button · key home · 40,52 120×120 px · ref 40,52 120×120"
 * ```
 */
export function itemLine(item: AreaItem, text?: string): string {
  const { node, source } = item;
  return joined([
    `- ${node.name} ${node.type}`,
    node.key === undefined ? undefined : `key ${node.key}`,
    textField(text),
    source === undefined ? undefined : sourceText(source),
    pxField(node),
    node.refRect === undefined ? undefined : `ref ${rectText(node.refRect)}`
  ]);
}

/**
 * The line of one child in the tree, indented two spaces per level: name and type, key, text and
 * its px bounds.
 *
 * @param child - The child and its level below the group element.
 * @returns `  - coinPillText text · key coinPillText · text "1 250" · 392,76 36×72 px`.
 * @example
 * ```ts
 * childLine({ node: homeIconNode, depth: 1, text: undefined }); // "  - homeIcon icon · key homeIcon · 61,73 79×79 px"
 * ```
 */
export function childLine(child: AreaChild): string {
  const { node } = child;
  return `${"  ".repeat(child.depth)}${joined([
    `- ${node.name} ${node.type}`,
    node.key === undefined ? undefined : `key ${node.key}`,
    textField(child.text),
    pxField(node)
  ])}`;
}

/**
 * The lines of one group element: its line, its child tree and "+N more" when the tree cap cut it.
 *
 * @param item - The element and its source.
 * @param branch - Its text and tree, undefined for none.
 * @returns The lines.
 */
function itemLines(item: AreaItem, branch: AreaBranch | undefined): string[] {
  if (branch === undefined) return [itemLine(item)];
  const more = branch.more > 0 ? [`  +${branch.more} more`] : [];
  return [itemLine(item, branch.text), ...branch.children.map(child => childLine(child)), ...more];
}

/**
 * The line of the nodes partly in the area.
 *
 * @param partly - The nodes.
 * @returns `partly in the area: boardBackground image 0,0 1080×1440 px`, undefined for none.
 */
function partlyLine(partly: readonly SceneNode[]): string | undefined {
  if (partly.length === 0) return undefined;
  const nodes = partly.map(node =>
    [node.name, node.type, pxField(node)].filter(field => field !== undefined).join(" ")
  );
  return `partly in the area: ${nodes.join(" · ")}`;
}

/**
 * The block of an area: the head, one line per element with its child tree, "+N more" past the
 * cap, the layout lines, the partly line and the tail lines.
 *
 * @param facts - The area facts.
 * @param card - The card file the head names, undefined for none.
 * @returns The block, one fact per line.
 * @example
 * ```ts
 * areaBlock(facts, ".moku/captures/2026-10-05/area-f25.md").split("\n")[1]; // "- home button · key home · 40,52 120×120 px · ref 40,52 120×120"
 * ```
 */
export function areaBlock(facts: AreaFacts, card: string | undefined): string {
  const more = facts.total - facts.items.length;
  const lines = [
    areaHead(facts, card),
    ...facts.items.flatMap(item => itemLines(item, facts.branches.get(item.node.id))),
    more > 0 ? `+${more} more` : undefined,
    ...facts.layouts.map(layout => `layout: ${layout}`),
    partlyLine(facts.partly),
    ...tailLines(facts)
  ];
  return lines.filter(entry => entry !== undefined).join("\n");
}

/**
 * The card file of an area: a heading with its size, the block in a text fence, the code of the
 * elements (each section names its element), the definitions of the components the area uses
 * (`## <key> · component <Name> · <file:line>`) and the pictures of the pick.
 *
 * @param block - The area block.
 * @param facts - The facts it was built from (the area and the pick's files).
 * @param codes - The code of the elements with a source.
 * @param components - The component definitions, none by default.
 * @returns The markdown text, ending with a newline.
 */
export function areaCardText(
  block: string,
  facts: AreaFacts,
  codes: readonly AreaCode[],
  components: readonly AreaComponent[] = []
): string {
  const { area, pick } = facts;
  const images = [
    pick?.crop === undefined ? undefined : `![area](${fileName(pick.crop)})`,
    pick?.full === undefined ? undefined : `![frame](${fileName(pick.full)})`
  ].filter(image => image !== undefined);
  const sections = [
    [`# @moku area ${Math.round(area.w)}×${Math.round(area.h)}`],
    fenced(block.split("\n"), "text"),
    ...codes.flatMap(({ node, code }) => codeSections(code, node.name)),
    ...components.map(({ key, name, snippet }) =>
      snippetSection(`${key} · component ${name}`, snippet)
    ),
    ...(images.length === 0 ? [] : [images])
  ];
  return `${sections.map(section => section.join("\n")).join("\n\n")}\n`;
}
