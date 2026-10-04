/**
 * @file Shared view module — scene: element at a point, page ↔ client transforms, ancestors.
 */
import type { FrameBoxLike, PageRect, SceneNode, SceneSnapshot } from "./types";

/**
 * A point in px.
 */
type Point = { readonly x: number; readonly y: number };

/**
 * Tells whether a rect contains a point: left and top edges in, right and bottom edges out.
 *
 * @param rect - The rect.
 * @param point - The point.
 * @returns True when the point is inside.
 * @example
 * ```ts
 * contains({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5 }); // true
 * ```
 */
function contains(rect: PageRect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

/** The ui types that only lay out their children: they draw nothing unless styled to. */
const LAYOUT_TYPES: ReadonlySet<string> = new Set(["screen", "column", "row", "stack", "spacer"]);

/** The style keys that make a layout node draw something of its own. */
const DRAWING_KEYS: readonly string[] = ["fill", "stroke", "nineSlice", "shape"];

/**
 * Tells whether a node only lays out its children: a ui column, row, stack, screen or spacer with
 * no fill, stroke, nine-slice or shape. It draws nothing and takes no tap in the game, so the
 * picker looks through it (merge-game's full-screen `homeTop` column lies over the Play button).
 *
 * @param node - A scene node.
 * @returns True for a layout-only node.
 * @example
 * ```ts
 * isLayoutOnly(homeTopNode); // true: a column with position and padding only
 * isLayoutOnly(backdropNode); // false: a button with a fill
 * ```
 */
function isLayoutOnly(node: SceneNode): boolean {
  if (node.ref.kind !== "ui" || !LAYOUT_TYPES.has(node.type)) return false;
  const style = node.style ?? {};
  return DRAWING_KEYS.every(key => style[key] === undefined);
}

/**
 * The last node in paint order that contains the point and draws or takes input (rule 6). An
 * invisible node (alpha 0 or `visible: false`, merge-game's glow over each cell at rest) is
 * skipped: the picker finds what is drawn under it. A layout-only node (see `isLayoutOnly`) is
 * looked through: it wins only where no other node contains the point. A node covering the whole
 * device that draws (a popup backdrop) contains every point, so it blocks everything painted
 * before it: a node painted after it wins where it contains the point, the backdrop wins
 * elsewhere.
 *
 * @param scene - The scene.
 * @param point - A point in page px (reference units when the scene is not calibrated).
 * @param point.x - Page x.
 * @param point.y - Page y.
 * @returns The node, or undefined when no placed node contains the point.
 * @example
 * ```ts
 * elementAt(scene, { x: 540, y: 990 })?.ref; // { kind: "entity", id: 1048628 }
 * elementAt(settingsScene, { x: 980, y: 112 })?.id; // "ui:settingsScreen/settingsBackdrop"
 * ```
 */
export function elementAt(
  scene: SceneSnapshot,
  point: { readonly x: number; readonly y: number }
): SceneNode | undefined {
  let layout: SceneNode | undefined;
  for (const id of scene.paintOrder.toReversed()) {
    const node = scene.nodes.get(id);
    if (node?.rect === undefined || !node.visible || !contains(node.rect, point)) continue;
    if (!isLayoutOnly(node)) return node;
    layout ??= node;
  }

  return layout;
}

/**
 * Client px → page px: (client − box origin) / box scale.
 *
 * @param client - A client point.
 * @param client.x - Client x.
 * @param client.y - Client y.
 * @param box - The frame box (workspace `gameFrame().box()`).
 * @returns The point in page px.
 * @example
 * ```ts
 * pageFromClient({ x: 300, y: 200 }, { left: 100, top: 50, scale: 0.5 }); // { x: 400, y: 300 }
 * ```
 */
export function pageFromClient(
  client: { readonly x: number; readonly y: number },
  box: FrameBoxLike
): { x: number; y: number } {
  return { x: (client.x - box.left) / box.scale, y: (client.y - box.top) / box.scale };
}

/**
 * Page px → client px (the inverse of pageFromClient).
 *
 * @param page - A page point.
 * @param page.x - Page x.
 * @param page.y - Page y.
 * @param box - The frame box (workspace `gameFrame().box()`).
 * @returns The point in client px.
 * @example
 * ```ts
 * clientFromPage({ x: 400, y: 300 }, { left: 100, top: 50, scale: 0.5 }); // { x: 300, y: 200 }
 * ```
 */
export function clientFromPage(
  page: { readonly x: number; readonly y: number },
  box: FrameBoxLike
): { x: number; y: number } {
  return { x: page.x * box.scale + box.left, y: page.y * box.scale + box.top };
}

/**
 * The ancestor ids of a node, root first; empty for a root or an unknown id.
 *
 * @param scene - The scene.
 * @param id - A node id.
 * @returns The ancestor ids, the node itself not included.
 * @example
 * ```ts
 * ancestorsOf(scene, "ui:boardScreen/hudRow/coinPill"); // ["ui:boardScreen", "ui:boardScreen/hudRow"]
 * ```
 */
export function ancestorsOf(scene: SceneSnapshot, id: string): readonly string[] {
  const ancestors: string[] = [];
  const seen = new Set([id]);
  let parent = scene.nodes.get(id)?.parent;

  while (parent !== undefined && !seen.has(parent)) {
    ancestors.push(parent);
    seen.add(parent);
    parent = scene.nodes.get(parent)?.parent;
  }

  return ancestors.toReversed();
}
