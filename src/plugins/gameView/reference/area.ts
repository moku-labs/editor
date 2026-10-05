/**
 * @file gameView plugin — the area pick of Reference mode (U9) and of MCP `moku_select { rect }`:
 * the group of an area (visible placed nodes fully inside it, else the ones it covers by half of
 * their own area; group roots only; top to bottom, then left to right; at most 40), then the pick
 * path with the area: bookmark, full shot, crop to the area plus 8 px, the card
 * `<capturesDir>/<yyyy-mm-dd>/area-f<frame>.md`, the area line on the clipboard and the capture
 * card. The card prints the child tree, the texts, the layout lines, the nodes partly in the area
 * and the components the area uses (captures-by-day U5). The selection is published first without
 * the sources, then again with the sources (at most 10 new searches, A18) and the files.
 */
import { linkPlugin } from "../../link";
import type { Calibration, PageRect, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { ancestorsOf } from "../../panels/shared/scene";
import type { SelectionInfo } from "../../registry/protocol";
import { cardFolder, cardPath } from "../capture/naming";
import { listTaken } from "../capture/shot";
import { copyText } from "../clipboard";
import { isCurrent, knownSource, publishSelection, selectionContext } from "../element/publish";
import { applySelection } from "../element/select";
import { areaSelection, itemOf } from "../element/selection";
import { findStyleSource } from "../element/source";
import { messageOf } from "../report";
import { readFreshScene } from "../scene/read";
import type { GameViewCtx, StyleSource } from "../types";
import {
  type AreaCode,
  type AreaFacts,
  type AreaItem,
  areaBlock,
  areaCardText,
  areaHead
} from "./area-block";
import { type AreaComponent, areaComponents, type SearchBudget } from "./area-components";
import {
  areaBranches,
  inside,
  layoutLines,
  overlapOf,
  partlyInArea,
  type TextOf
} from "./area-tree";
import { codeOf } from "./card";
import { contentOf, rawUiNodeAt, tailFacts } from "./facts";
import { pickToast, saveShots, showPickCard, takeBookmark } from "./pick";

/**
 * The most elements an area keeps; the card says how many more there were.
 */
export const AREA_ITEMS = 40;

/**
 * The most new source searches one area starts (A18); remembered sources are free.
 */
const AREA_SEARCHES = 10;

/**
 * Without a node fully inside, a node joins when the area covers this share of its own area.
 */
const HALF = 0.5;

/**
 * The name of an area's bookmark and files.
 */
const AREA_NAME = "area";

/**
 * The group of an area: at most 40 nodes in page order, and how many there were.
 *
 * @example
 * ```ts
 * const group: AreaGroup = { nodes: [homeNode, coinPillNode], total: 2 };
 * ```
 */
export type AreaGroup = { readonly nodes: readonly SceneNode[]; readonly total: number };

/**
 * How an area pick ends: `copy` puts the line on the clipboard with a toast; `card` takes the
 * bookmark and the shots and writes the card (MCP passes `card: false` to only select).
 */
export type AreaOptions = { readonly copy: boolean; readonly card: boolean };

/**
 * A drag in Reference mode: the line on the clipboard, the bookmark, the shots and the card.
 */
const DRAG_PICK: AreaOptions = { copy: true, card: true };

/**
 * A node with a rect.
 */
type Placed = SceneNode & { readonly rect: PageRect };

/**
 * True when the area covers at least half of a rect.
 *
 * @param rect - A node's rect.
 * @param area - The area.
 * @returns Whether half of it or more is in the area.
 */
function halfCovered(rect: PageRect, area: PageRect): boolean {
  const covered = overlapOf(rect, area);
  return covered > 0 && covered >= HALF * rect.w * rect.h;
}

/**
 * The visible nodes with a rect that has a size.
 *
 * @param scene - The scene.
 * @returns The nodes.
 */
function placedNodes(scene: SceneSnapshot): Placed[] {
  return [...scene.nodes.values()].filter(
    (node): node is Placed =>
      node.visible && node.rect !== undefined && node.rect.w > 0 && node.rect.h > 0
  );
}

/**
 * The group of an area in a calibrated scene: the visible placed nodes fully inside it, else the
 * ones it covers by half of their own area; a node whose ancestor is in too is dropped; top to
 * bottom, then left to right; at most 40. An uncalibrated scene has none: its rects are not
 * device px.
 *
 * @param scene - The scene.
 * @param area - The area in device CSS px.
 * @returns The group and its size before the cap.
 * @example
 * ```ts
 * areaGroup(boardScene, { x: 30, y: 45, w: 520, h: 135 }).nodes.map(node => node.key); // ["home", "coinPill"]
 * ```
 */
export function areaGroup(scene: SceneSnapshot, area: PageRect): AreaGroup {
  if (!scene.calibrated) return { nodes: [], total: 0 };

  const placed = placedNodes(scene);
  const contained = placed.filter(node => inside(node.rect, area));
  const members =
    contained.length > 0 ? contained : placed.filter(node => halfCovered(node.rect, area));

  // Group roots only: an element inside a member travels with it.
  const ids = new Set(members.map(node => node.id));
  const roots = members.filter(node => !ancestorsOf(scene, node.id).some(id => ids.has(id)));
  const ordered = roots.toSorted((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  return { nodes: ordered.slice(0, AREA_ITEMS), total: ordered.length };
}

/**
 * The area in the game's reference units, through the inverse of the calibration.
 *
 * @param area - The area in page px.
 * @param calibration - The calibration of the scene, undefined when there is none.
 * @returns The area in reference units, undefined without a calibration.
 */
function refAreaOf(area: PageRect, calibration: Calibration | undefined): PageRect | undefined {
  if (calibration === undefined || calibration.scale <= 0) return undefined;
  const { scale } = calibration;
  return {
    x: (area.x - calibration.x) / scale,
    y: (area.y - calibration.y) / scale,
    w: area.w / scale,
    h: area.h / scale
  };
}

/**
 * The SelectionInfo of an area with the sources known for its items.
 *
 * @param ctx - Domain context of gameView.
 * @param area - The area.
 * @param items - The group with its sources.
 * @param frame - The frame the selection shows.
 * @returns The info.
 */
function areaInfo(
  ctx: GameViewCtx,
  area: PageRect,
  items: readonly AreaItem[],
  frame: number
): SelectionInfo {
  const selectionItems = items.map(item => itemOf(item.node, item.source));
  return areaSelection(area, selectionItems, selectionContext(ctx, frame));
}

/**
 * Searches the source of a key; a failure is logged at debug and found nothing.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @returns The source, or undefined.
 */
async function searchQuietly(ctx: GameViewCtx, key: string): Promise<StyleSource | undefined> {
  try {
    return await findStyleSource(ctx, key);
  } catch (error) {
    ctx.log.debug("gameView: area source failed", { message: messageOf(error) });
    return undefined;
  }
}

/**
 * The group with the sources of its keys: remembered ones, then new searches one after the other
 * while the budget lasts (10 per area, A18).
 *
 * @param ctx - Domain context of gameView.
 * @param nodes - The group.
 * @param budget - The searches the area may still start.
 * @returns Each node with its source.
 */
async function withSources(
  ctx: GameViewCtx,
  nodes: readonly SceneNode[],
  budget: SearchBudget
): Promise<readonly AreaItem[]> {
  const items: AreaItem[] = [];
  for (const node of nodes) {
    const known = knownSource(ctx, node);
    const needsNoSearch = known !== undefined || node.key === undefined || budget.left <= 0;
    if (needsNoSearch) {
      items.push({ node, source: known });
      continue;
    }
    budget.left -= 1;
    items.push({ node, source: await searchQuietly(ctx, node.key) });
  }
  return items;
}

/**
 * The text a node shows: the `content` of its raw `game.ui` node, else of its style.
 *
 * @param ctx - Domain context of gameView.
 * @returns The reader of a node's text.
 */
function textReader(ctx: GameViewCtx): TextOf {
  const { ui } = ctx.state.sources;
  return node =>
    contentOf(node, node.ref.kind === "ui" ? rawUiNodeAt(ui, node.ref.path) : undefined);
}

/**
 * The group with the sources already known, for the first publish.
 *
 * @param ctx - Domain context of gameView.
 * @param nodes - The group.
 * @returns Each node with its remembered source.
 */
function knownItems(ctx: GameViewCtx, nodes: readonly SceneNode[]): readonly AreaItem[] {
  return nodes.map(node => ({ node, source: knownSource(ctx, node) }));
}

/**
 * The code of every element whose source is known, for the card; one that fails is left out.
 * A known source is remembered in `state.found`, so no code starts a new search.
 *
 * @param ctx - Domain context of gameView.
 * @param items - The group with its sources.
 * @returns One code per element with a source, in group order.
 */
async function areaCodes(
  ctx: GameViewCtx,
  items: readonly AreaItem[]
): Promise<readonly AreaCode[]> {
  const sourced = items.filter(item => item.source !== undefined);
  const codes = await Promise.all(
    sourced.map(async ({ node }) => ({ node, code: await codeOf(ctx, node) }))
  );
  return codes.filter((entry): entry is AreaCode => entry.code !== undefined);
}

/**
 * Writes the card of an area: `area-f<frame>.md` beside its pictures (today's folder under
 * `capturesDir` without them), `-2` … when taken; its block
 * names the card in its head.
 *
 * @param ctx - Domain context of gameView.
 * @param facts - The area facts.
 * @param codes - The code of the elements with a source.
 * @param components - The definitions of the components the area uses.
 * @returns The card path, undefined when it could not be written (logged).
 */
async function writeAreaCard(
  ctx: GameViewCtx,
  facts: AreaFacts,
  codes: readonly AreaCode[],
  components: readonly AreaComponent[]
): Promise<string | undefined> {
  try {
    const folder = cardFolder(ctx.config.capturesDir, facts.pick?.full, new Date());
    const taken = await listTaken(ctx, folder);
    const path = cardPath(folder, AREA_NAME, facts.frame, taken);
    const text = areaCardText(areaBlock(facts, path), facts, codes, components);
    await ctx.require(linkPlugin).files.write(path, text);
    return path;
  } catch (error) {
    ctx.log.warn("gameView: area card failed", { message: messageOf(error) });
    return undefined;
  }
}

/**
 * Publishes the area again once the sources of its keys are searched, when a source was found
 * and no other selection came first.
 *
 * @param ctx - Domain context of gameView.
 * @param first - The area as first published.
 * @param area - The area.
 * @param group - Its group.
 * @param frame - The frame of the selection.
 */
async function followSources(
  ctx: GameViewCtx,
  first: SelectionInfo,
  area: PageRect,
  group: AreaGroup,
  frame: number
): Promise<void> {
  const items = await withSources(ctx, group.nodes, { left: AREA_SEARCHES });
  const known = first.items ?? [];
  const found = items.some(
    (item, index) => item.source !== undefined && known[index]?.source === undefined
  );
  if (found && isCurrent(ctx, first)) publishSelection(ctx, areaInfo(ctx, area, items, frame));
}

/**
 * The pick path of an area: bookmark, shots, sources, the card, the line on the clipboard (when
 * `copy`), the capture card, and the area published with its files while it is still current.
 *
 * @param ctx - Domain context of gameView.
 * @param scene - The scene of the area.
 * @param area - The area.
 * @param group - Its group.
 * @param first - The area as first published.
 * @param copy - Put the line on the clipboard with a toast.
 * @returns The area selection with its card, crop and line.
 */
async function completeArea(
  ctx: GameViewCtx,
  scene: SceneSnapshot,
  area: PageRect,
  group: AreaGroup,
  first: SelectionInfo,
  copy: boolean
): Promise<SelectionInfo> {
  // Bookmark and shots first, so they show the frame the area was picked on.
  const taken = await takeBookmark(ctx, AREA_NAME);
  const shots = await saveShots(ctx, AREA_NAME, area, scene);

  // The sources of the group, then everything the block prints.
  const budget: SearchBudget = { left: AREA_SEARCHES };
  const items = await withSources(ctx, group.nodes, budget);
  const frame = shots?.frame ?? taken?.bookmark.frame ?? scene.frame;
  const pick = { bookmark: taken?.bookmark.id, crop: shots?.crop, full: shots?.full };
  const branches = areaBranches(scene, group.nodes, textReader(ctx));
  const facts: AreaFacts = {
    ...(await tailFacts(ctx, frame, pick, taken?.tainted)),
    area,
    refArea: scene.calibrated ? refAreaOf(area, ctx.state.calibration) : undefined,
    items,
    total: group.total,
    branches,
    layouts: layoutLines(scene, group.nodes),
    partly: partlyInArea(scene, area, group.nodes)
  };

  // The code of every element with a source, then the components the roots and children are instances of.
  const codes = await areaCodes(ctx, items);
  const components = await areaComponents(ctx, group.nodes, branches, budget);
  const card = await writeAreaCard(ctx, facts, codes, components);
  const line = areaHead(facts, card);

  // Tell the user: the line on the clipboard, the capture card.
  if (copy) await copyText(ctx, line, pickToast(shots !== undefined, taken !== undefined));
  showPickCard(ctx, shots, line);

  // Publish the area with its files while it is still the selection.
  const info: SelectionInfo = {
    ...areaInfo(ctx, area, items, frame),
    ...(card === undefined ? {} : { card }),
    ...(shots?.crop === undefined ? {} : { crop: shots.crop }),
    line
  };
  if (isCurrent(ctx, first)) publishSelection(ctx, info);
  return info;
}

/**
 * Picks an area: its group becomes the selection (the single element selection is cleared) and
 * is published at once; with `card`, the pick path follows (bookmark, shots, card, line, capture
 * card) and the area is published again with its sources and files; without, the sources follow
 * in a second publish. Never rejects.
 *
 * @param ctx - Domain context of gameView.
 * @param scene - The scene the area is in.
 * @param area - The area in device CSS px.
 * @param options - `copy` and `card`; both true for a drag in Reference mode.
 * @returns The area selection, with its card, crop and line after a card.
 */
export async function pickArea(
  ctx: GameViewCtx,
  scene: SceneSnapshot,
  area: PageRect,
  options: AreaOptions = DRAG_PICK
): Promise<SelectionInfo> {
  const group = areaGroup(scene, area);
  applySelection(ctx);
  const first = areaInfo(ctx, area, knownItems(ctx, group.nodes), scene.frame);
  publishSelection(ctx, first);

  if (!options.card) {
    void followSources(ctx, first, area, group, scene.frame);
    return first;
  }
  return completeArea(ctx, scene, area, group, first, options.copy);
}

/**
 * The area a drag in Reference mode ended with: reads the scene once more (the watched one can be
 * a heartbeat behind, R6), the one there is when that read fails, then picks the area. Nothing
 * without any scene. Never rejects.
 *
 * @param ctx - Domain context of gameView.
 * @param area - The marquee in device CSS px.
 * @returns Resolves when the pick completed.
 */
export async function pickDraggedArea(ctx: GameViewCtx, area: PageRect): Promise<void> {
  let scene: SceneSnapshot | undefined;
  try {
    scene = await readFreshScene(ctx);
  } catch (error) {
    ctx.log.debug("gameView: area read failed", { message: messageOf(error) });
    scene = ctx.state.scene;
  }
  if (scene !== undefined) await pickArea(ctx, scene, area);
}
