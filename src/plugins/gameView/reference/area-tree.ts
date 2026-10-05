/**
 * @file gameView plugin — what the fuller area card (captures-by-day U5) adds around the group,
 * pure: the child tree under each group root (visible descendants, 3 levels at most, 60 lines in
 * the whole tree, then "+N more"), the short text of a node, one layout line per parent chain of
 * the roots, and the nodes partly in the area (not inside, no parent a layout line names, no node
 * of the group's trees; largest overlap first, at most 8).
 */
import type { PageRect, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { ancestorsOf } from "../../panels/shared/scene";
import { LAYOUT_PARENTS, layoutOf } from "./block";

/**
 * The levels below a group root the tree goes.
 */
export const TREE_DEPTH = 3;

/**
 * The child lines of the whole tree.
 */
export const TREE_LINES = 60;

/**
 * The nodes the "partly in the area" line names.
 */
export const PARTLY_NODES = 8;

/**
 * The characters a text keeps; a longer one ends with "…".
 */
const TEXT_CHARS = 40;

/**
 * One child line of the tree: the node, its level below the root (1 = a child) and its text.
 */
export type AreaChild = {
  readonly node: SceneNode;
  readonly depth: number;
  readonly text: string | undefined;
};

/**
 * The tree of one group root: the root's own text, its child lines and how many the cap left out.
 */
export type AreaBranch = {
  readonly text: string | undefined;
  readonly children: readonly AreaChild[];
  readonly more: number;
};

/**
 * Reads the text a node shows, when the game reports one.
 */
export type TextOf = (node: SceneNode) => string | undefined;

/**
 * A node with a rect.
 */
type Placed = SceneNode & { readonly rect: PageRect };

/**
 * A text for a card line: trimmed, at most 40 characters ("…" at the cut), none when empty.
 *
 * @param text - The text the game reports.
 * @returns The short text, undefined for none.
 * @example
 * ```ts
 * shortText("  1 250 "); // "1 250"
 * ```
 */
export function shortText(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  return trimmed.length > TEXT_CHARS ? `${trimmed.slice(0, TEXT_CHARS - 1)}…` : trimmed;
}

/**
 * The visible children of a node, in order.
 *
 * @param scene - The scene.
 * @param node - The node.
 * @returns The child nodes.
 */
function visibleChildren(scene: SceneSnapshot, node: SceneNode): SceneNode[] {
  return node.children.flatMap(id => {
    const child = scene.nodes.get(id);
    return child?.visible === true ? [child] : [];
  });
}

/**
 * The first text under a node, depth first: a badge count or a label the tree does not reach.
 *
 * @param scene - The scene.
 * @param node - The node.
 * @param textOf - Reads a node's text.
 * @returns The short text, undefined when no node under it has one.
 */
function textBelow(scene: SceneSnapshot, node: SceneNode, textOf: TextOf): string | undefined {
  for (const child of visibleChildren(scene, node)) {
    const text = shortText(textOf(child)) ?? textBelow(scene, child, textOf);
    if (text !== undefined) return text;
  }
  return undefined;
}

/**
 * The child lines of a root, depth first, 3 levels at most. A node on the last level shows the
 * first text under it.
 *
 * @param scene - The scene.
 * @param root - The group root.
 * @param textOf - Reads a node's text.
 * @returns Every child line of the root.
 */
function childLines(scene: SceneSnapshot, root: SceneNode, textOf: TextOf): AreaChild[] {
  const lines: AreaChild[] = [];
  const visit = (node: SceneNode, depth: number): void => {
    for (const child of visibleChildren(scene, node)) {
      const own = shortText(textOf(child));
      const last = depth === TREE_DEPTH;
      lines.push({
        node: child,
        depth,
        text: own ?? (last ? textBelow(scene, child, textOf) : undefined)
      });
      if (!last) visit(child, depth + 1);
    }
  };
  visit(root, 1);
  return lines;
}

/**
 * The tree under each group root: its visible descendants, 3 levels at most, 60 child lines in
 * the whole tree; a root the cap cut says how many more it had.
 *
 * @param scene - The scene.
 * @param roots - The group roots, in card order.
 * @param textOf - Reads a node's text.
 * @returns The branch of each root, by node id.
 * @example
 * ```ts
 * areaBranches(boardScene, [homeNode], () => undefined).get(homeNode.id)?.children[0]?.node.name; // "homeIcon"
 * ```
 */
export function areaBranches(
  scene: SceneSnapshot,
  roots: readonly SceneNode[],
  textOf: TextOf
): ReadonlyMap<string, AreaBranch> {
  const branches = new Map<string, AreaBranch>();
  let left = TREE_LINES;
  for (const root of roots) {
    const lines = childLines(scene, root, textOf);
    const children = lines.slice(0, left);
    left -= children.length;
    const text = shortText(textOf(root));
    branches.set(root.id, { text, children, more: lines.length - children.length });
  }
  return branches;
}

/**
 * The ui parents a layout line names for a node, nearest first, 3 at most.
 *
 * @param scene - The scene.
 * @param node - The node.
 * @returns The parents.
 */
function layoutParents(scene: SceneSnapshot, node: SceneNode): SceneNode[] {
  return ancestorsOf(scene, node.id)
    .toReversed()
    .flatMap(id => scene.nodes.get(id) ?? [])
    .filter(parent => parent.ref.kind === "ui")
    .slice(0, LAYOUT_PARENTS);
}

/**
 * One layout line per parent chain of the roots, in the form of a single element's `layout:`:
 * the roots that share the chain, then up to 3 parents with their layout.
 *
 * @param scene - The scene.
 * @param roots - The group roots, in card order.
 * @returns The lines without the `layout: ` label; none for a root without parents.
 */
export function layoutLines(scene: SceneSnapshot, roots: readonly SceneNode[]): readonly string[] {
  // Group the roots by their parent chain.
  const chains = new Map<string, { names: string[]; parents: SceneNode[] }>();
  for (const root of roots) {
    const parents = layoutParents(scene, root);
    if (parents.length === 0) continue;
    const id = parents.map(parent => parent.id).join(" ");
    const chain = chains.get(id);
    if (chain === undefined) chains.set(id, { names: [root.name], parents });
    else chain.names.push(root.name);
  }

  // One line per chain: the roots, then each parent with its layout.
  return [...chains.values()].map(
    chain =>
      `${chain.names.join(", ")} < ${chain.parents.map(parent => layoutOf(parent)).join(" < ")}`
  );
}

/**
 * The area two rects share, 0 when they do not overlap.
 *
 * @param rect - A node's rect.
 * @param area - The area.
 * @returns The shared area in square px.
 * @example
 * ```ts
 * overlapOf({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }); // 25
 * ```
 */
export function overlapOf(rect: PageRect, area: PageRect): number {
  const w = Math.min(rect.x + rect.w, area.x + area.w) - Math.max(rect.x, area.x);
  const h = Math.min(rect.y + rect.h, area.y + area.h) - Math.max(rect.y, area.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * True when a rect lies fully inside the area.
 *
 * @param rect - A node's rect.
 * @param area - The area.
 * @returns Whether it is inside.
 * @example
 * ```ts
 * inside({ x: 2, y: 2, w: 4, h: 4 }, { x: 0, y: 0, w: 10, h: 10 }); // true
 * ```
 */
export function inside(rect: PageRect, area: PageRect): boolean {
  return (
    rect.x >= area.x &&
    rect.y >= area.y &&
    rect.x + rect.w <= area.x + area.w &&
    rect.y + rect.h <= area.y + area.h
  );
}

/**
 * The ids the "partly" line leaves out: every node of the group's trees and every parent a
 * layout line names.
 *
 * @param scene - The scene.
 * @param roots - The group roots.
 * @returns The ids.
 */
function impliedIds(scene: SceneSnapshot, roots: readonly SceneNode[]): Set<string> {
  const ids = new Set<string>();
  const addTree = (node: SceneNode): void => {
    ids.add(node.id);
    for (const id of node.children) {
      const child = scene.nodes.get(id);
      if (child !== undefined && !ids.has(child.id)) addTree(child);
    }
  };
  for (const root of roots) {
    addTree(root);
    for (const parent of layoutParents(scene, root)) ids.add(parent.id);
  }
  return ids;
}

/**
 * True for a node partly in the area: visible, placed, overlapping it but not inside, and not
 * implied by the group's trees or layout lines.
 *
 * @param node - The node.
 * @param area - The area in device CSS px.
 * @param implied - The ids of the group's trees and of the parents its layout lines name.
 * @returns Whether the node is partly in the area.
 */
function isPartlyIn(node: SceneNode, area: PageRect, implied: ReadonlySet<string>): node is Placed {
  return (
    node.visible &&
    node.rect !== undefined &&
    !implied.has(node.id) &&
    overlapOf(node.rect, area) > 0 &&
    !inside(node.rect, area)
  );
}

/**
 * The nodes partly in the area: visible, placed, overlapping it but not inside, not in the
 * group's trees and not a parent a layout line names (a background, the screen root above the
 * chain). Largest overlap first, then top to bottom; at most 8. None in a scene without a
 * calibration: its rects are not device px.
 *
 * @param scene - The scene.
 * @param area - The area in device CSS px.
 * @param roots - The group roots.
 * @returns The nodes.
 * @example
 * ```ts
 * partlyInArea(boardScene, { x: 30, y: 45, w: 520, h: 135 }, [homeNode, coinPillNode]).map(node => node.name); // ["boardBackground"]
 * ```
 */
export function partlyInArea(
  scene: SceneSnapshot,
  area: PageRect,
  roots: readonly SceneNode[]
): readonly SceneNode[] {
  if (!scene.calibrated) return [];

  const implied = impliedIds(scene, roots);
  const partly = [...scene.nodes.values()].filter((node): node is Placed =>
    isPartlyIn(node, area, implied)
  );
  const ordered = partly.toSorted(
    (a, b) =>
      overlapOf(b.rect, area) - overlapOf(a.rect, area) ||
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x
  );
  return ordered.slice(0, PARTLY_NODES);
}
