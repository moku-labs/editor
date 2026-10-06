/**
 * @file gameView plugin — the selection as the editor page publishes it (U4, A10, U9), pure: the
 * SelectionInfo of a scene node (ref, key, projection, name, type, rect, source, session, frame,
 * at), of a ref the scene does not have, of an area with its items; the projection a node belongs
 * to; and the ui node a key names, plain or projection-qualified (`"hud/infoBar"`).
 */
import type { ElementRef, PageRect, SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import type { Json, SelectionInfo, SelectionItem } from "../../registry/protocol";
import { isObject } from "../capture/shot";
import type { StyleSource } from "../types";

/**
 * What every published selection carries besides its element: the game session, the frame and
 * the moment of the publish.
 *
 * @example
 * ```ts
 * const context: SelectionContext = { session: "s-1", frame: 1841, at: Date.now() };
 * ```
 */
export type SelectionContext = {
  readonly session: string | undefined;
  /** The scene frame; after a pick, the frame of the pick (A10). */
  readonly frame: number | undefined;
  /** `Date.now()` at the publish. */
  readonly at: number;
};

/**
 * What the info of one scene node is built from: the context, the `game.projections` value and
 * the index answer of its key.
 */
export type SelectionFacts = SelectionContext & {
  readonly projections: Json | undefined;
  readonly source: StyleSource | undefined;
};

/**
 * The element of an area selection with no element in it (A15).
 */
const NO_ELEMENT: ElementRef = { kind: "ui", path: "" };

/**
 * The file and the key line of a index answer, as a selection names them.
 *
 * @param source - A index answer.
 * @returns `{ path, line }`.
 * @example
 * ```ts
 * sourceAt({ kind: "defined", path: "src/hud/Hud.tsx", line: 12 }); // { path: "src/hud/Hud.tsx", line: 12 }
 * ```
 */
export function sourceAt(source: StyleSource): { readonly path: string; readonly line: number } {
  return { path: source.path, line: source.line };
}

/**
 * The session and the frame of a context, the ones that are known, and the moment.
 *
 * @param context - The context.
 * @returns The fields to spread into an info.
 */
function contextFields(context: SelectionContext): Pick<SelectionInfo, "session" | "frame" | "at"> {
  return {
    ...(context.session === undefined ? {} : { session: context.session }),
    ...(context.frame === undefined ? {} : { frame: context.frame }),
    at: context.at
  };
}

/**
 * The names of the projections whose keys hold a key.
 *
 * @param projections - The `game.projections` value: projection → key → entity id.
 * @param key - A ui key or a root key.
 * @returns The projection names, in the value's order.
 */
function holding(projections: { [name: string]: Json }, key: string): string[] {
  return Object.entries(projections)
    .filter(([, keys]) => isObject(keys) && typeof keys[key] === "number")
    .map(([name]) => name);
}

/**
 * The projection a node belongs to: an entity's owner; for a ui node the projection whose keys
 * hold its key (the game registers every keyed ui element under the projection of its root), the
 * one that also holds the node's root key when two hold it.
 *
 * @param projections - The `game.projections` value, undefined before the first read.
 * @param node - The scene node.
 * @returns The projection name, undefined when no projection names the node.
 * @example
 * ```ts
 * projectionOf(projections, infoBarNode); // "hud"
 * projectionOf(projections, boardItemNode); // "board.items"
 * ```
 */
export function projectionOf(projections: Json | undefined, node: SceneNode): string | undefined {
  if (node.entity !== undefined) return node.entity.owner;
  if (node.ref.kind !== "ui" || !isObject(projections)) return undefined;

  const own = node.key === undefined ? [] : holding(projections, node.key);
  const rooted = holding(projections, node.ref.path.split("/")[0] ?? "");
  return own.find(name => rooted.includes(name)) ?? own[0] ?? rooted[0];
}

/**
 * The element part of a selection: ref, key, name, type, rect and source, the known ones.
 *
 * @param node - The scene node.
 * @param source - The index answer of its key, undefined when not known.
 * @returns The item.
 * @example
 * ```ts
 * itemOf(homeNode, undefined); // { ref: { kind: "ui", path: "boardScreen/hudRow/home" }, key: "home", name: "home", type: "button", rect: { x: 40, y: 52, w: 120, h: 120 } }
 * ```
 */
export function itemOf(node: SceneNode, source: StyleSource | undefined): SelectionItem {
  return {
    ref: node.ref,
    ...(node.key === undefined ? {} : { key: node.key }),
    name: node.name,
    type: node.type,
    ...(node.rect === undefined ? {} : { rect: node.rect }),
    ...(source === undefined ? {} : { source: sourceAt(source) })
  };
}

/**
 * The SelectionInfo of one scene node.
 *
 * @param node - The selected node.
 * @param facts - The projections, its source, the session, the frame and the moment.
 * @returns The info, without the fields that are not known.
 * @example
 * ```ts
 * selectionOf(infoBarNode, { projections, source: undefined, session: "s-1", frame: 1841, at: Date.now() });
 * // { ref: { kind: "ui", path: "boardScreen/infoBar" }, key: "infoBar", projection: "hud", name: "infoBar", type: "row", rect: { … }, session: "s-1", frame: 1841, at: … }
 * ```
 */
export function selectionOf(node: SceneNode, facts: SelectionFacts): SelectionInfo {
  const projection = projectionOf(facts.projections, node);
  return {
    ...itemOf(node, facts.source),
    ...(projection === undefined ? {} : { projection }),
    ...contextFields(facts)
  };
}

/**
 * The SelectionInfo of a ref the scene does not have (yet): named by the last segment of its ui
 * path or by its entity id, typed by its kind.
 *
 * @param ref - The selected element.
 * @param context - The session, the frame and the moment.
 * @returns The info.
 * @example
 * ```ts
 * bareSelection({ kind: "ui", path: "settingsScreen/close" }, context).name; // "close"
 * ```
 */
export function bareSelection(ref: ElementRef, context: SelectionContext): SelectionInfo {
  const name = ref.kind === "ui" ? ref.path.slice(ref.path.lastIndexOf("/") + 1) : `#${ref.id}`;
  return { ref, name, type: ref.kind, ...contextFields(context) };
}

/**
 * The SelectionInfo of an area (U9): named and typed `area`, its rect and `area` the area, its ref
 * the first item's (the empty ui ref when nothing is inside), and the items.
 *
 * @param area - The area in page CSS px.
 * @param items - The group, top to bottom then left to right.
 * @param context - The session, the frame and the moment.
 * @returns The info.
 * @example
 * ```ts
 * areaSelection({ x: 30, y: 45, w: 520, h: 135 }, [home, coinPill], context).ref; // home's ref
 * ```
 */
export function areaSelection(
  area: PageRect,
  items: readonly SelectionItem[],
  context: SelectionContext
): SelectionInfo {
  return {
    ref: items[0]?.ref ?? NO_ELEMENT,
    name: "area",
    type: "area",
    rect: area,
    area,
    items,
    ...contextFields(context)
  };
}

/**
 * The ui node a key names: the first one whose key equals it, else, for a projection-qualified key
 * `<projection>/<key>`, the first one with that key in that projection.
 *
 * @param scene - The scene.
 * @param projections - The `game.projections` value.
 * @param key - `"infoBar"` or `"hud/infoBar"`.
 * @returns The node, undefined when none has the key.
 * @example
 * ```ts
 * elementByKey(scene, projections, "hud/infoBar")?.id; // "ui:boardScreen/infoBar"
 * ```
 */
export function elementByKey(
  scene: SceneSnapshot,
  projections: Json | undefined,
  key: string
): SceneNode | undefined {
  const nodes = [...scene.nodes.values()].filter(node => node.ref.kind === "ui");
  const exact = nodes.find(node => node.key === key);
  if (exact !== undefined) return exact;

  // "hud/infoBar": the key infoBar inside the projection hud.
  const slash = key.lastIndexOf("/");
  if (slash <= 0) return undefined;
  const projection = key.slice(0, slash);
  const bare = key.slice(slash + 1);
  return nodes.find(node => node.key === bare && projectionOf(projections, node) === projection);
}
