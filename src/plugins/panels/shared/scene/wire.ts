/**
 * @file Shared view module — scene: readers of the wire values. Narrows `Json` to the shapes of
 * game.ui (the UiNode tree), game.entities and game.projections, and walks the ui tree with its
 * fit chains. A value of the wrong shape gives the path where it sits, never a throw.
 */
import type { Json } from "../../../registry/protocol";
import type { FitLink } from "./fits";
import type { PageRect } from "./types";

/**
 * A JSON object of the wire.
 */
export type JsonObject = { readonly [key: string]: Json };

/**
 * Where a value of the wrong shape sits, e.g. `$.children[0].rect`.
 */
export type ShapePath = { readonly wrongAt: string };

/**
 * One node of game.ui: natural rect in root units, fit scale (1 when absent), children in order.
 */
export type UiWire = {
  readonly key: string | undefined;
  readonly type: string;
  readonly rect: PageRect;
  readonly style: JsonObject | undefined;
  readonly fitScale: number;
  readonly children: readonly UiWire[];
};

/**
 * One ui node met by uiVisits: its path, its parent's path and its fit chain, nearest first.
 */
export type UiVisit = {
  readonly node: UiWire;
  readonly path: string;
  readonly parent: string | undefined;
  readonly fits: readonly FitLink[];
};

/**
 * The owner of an entity: `{ kind: "projection", name: "board.items" }`, `{ kind: "plugin", name: "ui" }`.
 */
export type Owner = { readonly kind: string; readonly name: string };

/**
 * One entity of game.entities.
 */
export type EntityWire = {
  readonly id: number;
  readonly index: number;
  readonly owner: Owner;
  readonly components: JsonObject;
  readonly skipped: readonly string[];
};

/**
 * Where an entity sits in game.projections: projection name and key.
 */
export type Address = { readonly projection: string; readonly key: string };

/**
 * Tells a JSON object from the other JSON values.
 *
 * @param value - A JSON value, or undefined for a missing field.
 * @returns True for an object that is not an array.
 * @example
 * ```ts
 * isJsonObject({ x: 1 }); // true
 * ```
 */
export function isJsonObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tells a shape error from a value read.
 *
 * @param value - What a reader returned.
 * @returns True when it is the path of a wrong shape.
 * @example
 * ```ts
 * isShapePath({ wrongAt: "$" }); // true
 * ```
 */
export function isShapePath(value: object): value is ShapePath {
  return "wrongAt" in value;
}

/**
 * A finite number, or undefined.
 *
 * @param value - A JSON value.
 * @returns The number, or undefined for anything else.
 * @example
 * ```ts
 * numberOf(4); // 4
 * ```
 */
export function numberOf(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A string, or undefined.
 *
 * @param value - A JSON value.
 * @returns The string, or undefined for anything else.
 * @example
 * ```ts
 * stringOf("ui.hud-pill"); // "ui.hud-pill"
 * ```
 */
export function stringOf(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * A rect `{ x, y, w, h }` of four numbers, or undefined.
 *
 * @param value - A JSON value.
 * @returns The rect, or undefined when a field is missing or not a number.
 * @example
 * ```ts
 * rectOf({ x: 55, y: 801, w: 970, h: 970 }); // { x: 55, y: 801, w: 970, h: 970 }
 * ```
 */
export function rectOf(value: Json | undefined): PageRect | undefined {
  if (!isJsonObject(value)) return undefined;

  const x = numberOf(value.x);
  const y = numberOf(value.y);
  const w = numberOf(value.w);
  const h = numberOf(value.h);

  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;

  return { x, y, w, h };
}

/**
 * Reads the children of a ui node, each at its own path.
 *
 * @param children - The children array of the wire.
 * @param path - The path of the array.
 * @returns The nodes, or the path of the first wrong shape.
 * @example
 * ```ts
 * readUiChildren([], "$.children"); // []
 * ```
 */
function readUiChildren(children: readonly Json[], path: string): UiWire[] | ShapePath {
  const nodes: UiWire[] = [];

  for (const [index, child] of children.entries()) {
    const node = readUi(child, `${path}[${index}]`);

    if (isShapePath(node)) return node;
    nodes.push(node);
  }

  return nodes;
}

/**
 * Reads game.ui: `{ key?, type, rect, style?, fitScale?, children }` at every level.
 *
 * @param value - The game.ui value (or one node of it).
 * @param path - The path of the value, `$` at the top.
 * @returns The node tree, or the path of the first wrong shape.
 * @example
 * ```ts
 * readUi({ type: "screen", rect: { x: 0, y: 0, w: 0, h: 0 }, children: [] }).type; // "screen"
 * ```
 */
export function readUi(value: Json | undefined, path = "$"): UiWire | ShapePath {
  if (!isJsonObject(value)) return { wrongAt: path };

  const { key, style } = value;
  const type = stringOf(value.type);
  const rect = rectOf(value.rect);

  if (type === undefined) return { wrongAt: `${path}.type` };
  if (key !== undefined && typeof key !== "string") return { wrongAt: `${path}.key` };
  if (rect === undefined) return { wrongAt: `${path}.rect` };
  if (!Array.isArray(value.children)) return { wrongAt: `${path}.children` };

  const children = readUiChildren(value.children, `${path}.children`);

  if (isShapePath(children)) return children;

  return {
    key,
    type,
    rect,
    style: isJsonObject(style) ? style : undefined,
    fitScale: numberOf(value.fitScale) ?? 1,
    children
  };
}

/**
 * Tells the game's synthetic root: several mounted roots come under an unkeyed `screen` with a
 * zero rect (popups first, the topmost first), and so does an empty screen.
 *
 * @param node - The top node of game.ui.
 * @returns True for the synthetic root.
 * @example
 * ```ts
 * isSyntheticRoot({ key: undefined, type: "screen", rect: { x: 0, y: 0, w: 0, h: 0 }, style: undefined, fitScale: 1, children: [] }); // true
 * ```
 */
function isSyntheticRoot(node: UiWire): boolean {
  const { rect } = node;

  return (
    node.key === undefined &&
    node.type === "screen" &&
    rect.x === 0 &&
    rect.y === 0 &&
    rect.w === 0 &&
    rect.h === 0
  );
}

/**
 * The ui roots in reader order: the children of the synthetic root, else the one top node.
 *
 * @param top - The top node of game.ui.
 * @returns The roots.
 * @example
 * ```ts
 * uiRoots(top).map(root => root.key); // ["settingsScreen", "boardScreen"] while settings is open
 * ```
 */
export function uiRoots(top: UiWire): readonly UiWire[] {
  return isSyntheticRoot(top) ? top.children : [top];
}

/**
 * The path segment of a ui node: its key, else `type#index` among its siblings.
 *
 * @param node - The node.
 * @param index - Its index among its siblings.
 * @returns The segment.
 * @example
 * ```ts
 * segmentOf(columnWithoutKey, 0); // "column#0"
 * ```
 */
function segmentOf(node: UiWire, index: number): string {
  return node.key ?? `${node.type}#${index}`;
}

/**
 * Visits one node and its subtree, parents before children.
 *
 * @param node - The node.
 * @param path - Its path.
 * @param parent - Its parent's path, undefined for a root.
 * @param above - The fit chain of its parent, nearest first.
 * @yields {UiVisit} The visit of every node of the subtree.
 * @example
 * ```ts
 * [...visitsOf(root, "boardScreen", undefined, [])].length; // 69 on the merge-game board
 * ```
 */
function* visitsOf(
  node: UiWire,
  path: string,
  parent: string | undefined,
  above: readonly FitLink[]
): Generator<UiVisit, void, undefined> {
  const fits = [{ rect: node.rect, fitScale: node.fitScale }, ...above];

  yield { node, path, parent, fits };

  for (const [index, child] of node.children.entries()) {
    yield* visitsOf(child, `${path}/${segmentOf(child, index)}`, path, fits);
  }
}

/**
 * Every ui node in tree order, parents before children, from the roots in reader order. A path
 * joins the segments with "/"; the synthetic root is no node and adds no segment.
 *
 * @param top - The top node of game.ui.
 * @yields {UiVisit} One visit per ui node.
 * @example
 * ```ts
 * for (const { path } of uiVisits(top)) paths.push(path); // "boardScreen", "boardScreen/hudRow", …
 * ```
 */
export function* uiVisits(top: UiWire): Generator<UiVisit, void, undefined> {
  for (const [index, root] of uiRoots(top).entries()) {
    yield* visitsOf(root, segmentOf(root, index), undefined, []);
  }
}

/**
 * Reads the owner of an entity.
 *
 * @param value - The owner field.
 * @returns The owner, or undefined when kind or name is not a string.
 * @example
 * ```ts
 * ownerOf({ kind: "projection", name: "board.items" }); // { kind: "projection", name: "board.items" }
 * ```
 */
function ownerOf(value: Json | undefined): Owner | undefined {
  if (!isJsonObject(value)) return undefined;

  const kind = stringOf(value.kind);
  const name = stringOf(value.name);

  return kind === undefined || name === undefined ? undefined : { kind, name };
}

/**
 * The names of the components an entity carries without a JSON value.
 *
 * @param value - The skipped field.
 * @returns The names; empty when the field is absent.
 * @example
 * ```ts
 * skippedOf(["Text"]); // ["Text"]
 * ```
 */
function skippedOf(value: Json | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];

  return value.filter(item => typeof item === "string");
}

/**
 * Reads one entity: `{ id, index, owner { kind, name }, components, skipped? }`.
 *
 * @param value - One element of game.entities.
 * @param path - Its path.
 * @returns The entity, or the path of the wrong field.
 * @example
 * ```ts
 * readEntity({ id: 7, index: 0, owner: { kind: "plugin", name: "ui" }, components: {} }, "$[0]");
 * ```
 */
function readEntity(value: Json, path: string): EntityWire | ShapePath {
  if (!isJsonObject(value)) return { wrongAt: path };

  const id = numberOf(value.id);
  const index = numberOf(value.index);
  const owner = ownerOf(value.owner);
  const { components } = value;

  if (id === undefined) return { wrongAt: `${path}.id` };
  if (index === undefined) return { wrongAt: `${path}.index` };
  if (owner === undefined) return { wrongAt: `${path}.owner` };
  if (!isJsonObject(components)) return { wrongAt: `${path}.components` };

  return { id, index, owner, components, skipped: skippedOf(value.skipped) };
}

/**
 * Reads game.entities: an array of entities.
 *
 * @param value - The game.entities value.
 * @returns The entities in order, or the path of the first wrong shape.
 * @example
 * ```ts
 * readEntities([]); // []
 * ```
 */
export function readEntities(value: Json): readonly EntityWire[] | ShapePath {
  if (!Array.isArray(value)) return { wrongAt: "$" };

  const entities: EntityWire[] = [];

  for (const [index, item] of value.entries()) {
    const entity = readEntity(item, `$[${index}]`);

    if (isShapePath(entity)) return entity;
    entities.push(entity);
  }

  return entities;
}

/**
 * Reads game.projections, projection name to key to entity id, into the reverse lookup.
 *
 * @param value - The game.projections value.
 * @returns Entity id to its address, or the path of the first wrong shape.
 * @example
 * ```ts
 * readProjections({ "board.items": { i1: 1048628 } }); // Map { 1048628 → { projection: "board.items", key: "i1" } }
 * ```
 */
export function readProjections(value: Json): ReadonlyMap<number, Address> | ShapePath {
  if (!isJsonObject(value)) return { wrongAt: "$" };

  const addresses = new Map<number, Address>();

  for (const [projection, keys] of Object.entries(value)) {
    if (!isJsonObject(keys)) return { wrongAt: `$.${projection}` };

    for (const [key, id] of Object.entries(keys)) {
      if (typeof id !== "number") return { wrongAt: `$.${projection}.${key}` };
      addresses.set(id, { projection, key });
    }
  }

  return addresses;
}

/**
 * One component of an entity as a JSON object.
 *
 * @param entity - The entity.
 * @param name - The component name.
 * @returns The component value, or undefined when absent or not an object.
 * @example
 * ```ts
 * componentOf(item, "Sprite")?.texture; // "board.item-wood-3"
 * ```
 */
export function componentOf(entity: EntityWire, name: string): JsonObject | undefined {
  const value = entity.components[name];

  return isJsonObject(value) ? value : undefined;
}
