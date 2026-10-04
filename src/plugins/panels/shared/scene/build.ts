/**
 * @file Shared view module — scene: ui nodes, projection entities, host slots, paint order.
 * Rules 1–3, 5 and 9 of the scene mapping (11-panels, R8).
 */
import { toPage } from "./calibrate";
import { drawnRect, fitScaleOf } from "./fits";
import type {
  Calibration,
  ElementRef,
  PageRect,
  SceneError,
  SceneInput,
  SceneNode,
  SceneSnapshot
} from "./types";
import type { Address, EntityWire, JsonObject, UiVisit, UiWire } from "./wire";
import {
  componentOf,
  isJsonObject,
  isShapePath,
  numberOf,
  readEntities,
  readProjections,
  readUi,
  rectOf,
  stringOf,
  uiVisits
} from "./wire";

/**
 * A node before its children are known.
 */
type Draft = Omit<SceneNode, "children">;

/**
 * A ui node that can host projection entities: its drawn rect and the scale it is drawn at
 * (hostDrawn.w / host.rect.w).
 */
type Host = {
  readonly id: string;
  readonly key: string | undefined;
  readonly drawn: PageRect;
  readonly scale: number;
};

/**
 * A translation plus a uniform scale: child units → parent units.
 */
type Frame = { readonly x: number; readonly y: number; readonly scale: number };

/**
 * A display component (rule 2): its name, the node type it gives, the fields of its size and
 * whether it reads an anchor (only Sprite; NineSlice and Shape are anchored at 0,0).
 */
type Display = {
  readonly component: string;
  readonly type: string;
  readonly width: string;
  readonly height: string;
  readonly anchored: boolean;
};

/**
 * How an entity reaches its host: the ui-owned entity at the end of its Parent chain, the frame
 * of the entities passed on the way (undefined when one has no Transform), and whether the chain
 * runs in a loop.
 */
type Chain = {
  readonly hostEntity: EntityWire | undefined;
  readonly frame: Frame | undefined;
  readonly loops: boolean;
};

/**
 * A projection entity placed in the tree: its node id, its node parent and its Order.
 */
type Placed = { readonly id: string; readonly parent: string | undefined; readonly order: number };

/**
 * The entities and the projection keys, for the entity pass.
 */
type World = {
  readonly byId: ReadonlyMap<number, EntityWire>;
  readonly addresses: ReadonlyMap<number, Address>;
};

/**
 * The scene under construction.
 */
type Builder = {
  readonly calibration: Calibration | undefined;
  readonly drafts: Map<string, Draft>;
  readonly children: Map<string, string[]>;
  /** Natural rect ("x,y,w,h") → the ui nodes with that rect, in tree order. */
  readonly hosts: Map<string, Host[]>;
  readonly textures: Set<string>;
  readonly uiRoots: string[];
};

/**
 * The frame that changes nothing.
 */
const IDENTITY: Frame = { x: 0, y: 0, scale: 1 };

/**
 * The display components in priority order (rule 2).
 */
const DISPLAYS: readonly Display[] = [
  {
    component: "NineSlice",
    type: "NineSliceSprite",
    width: "width",
    height: "height",
    anchored: false
  },
  { component: "Sprite", type: "Sprite", width: "width", height: "height", anchored: true },
  { component: "Shape", type: "Graphics", width: "w", height: "h", anchored: false }
];

/**
 * The node type of an entity without a display component.
 */
const CONTAINER = "Container";

/**
 * The owner kind of the entities that become nodes.
 */
const PROJECTION = "projection";

/**
 * The node id of a ref: "ui:<path>" or "entity:<id>".
 *
 * @param ref - An element ref.
 * @returns The node id.
 * @example
 * ```ts
 * refId({ kind: "entity", id: 1_048_580 }); // "entity:1048580"
 * ```
 */
export function refId(ref: ElementRef): string {
  return ref.kind === "ui" ? `ui:${ref.path}` : `entity:${ref.id}`;
}

/**
 * The error value of a wrong shape (rule 9).
 *
 * @param source - The source whose value has the wrong shape.
 * @param path - Where in the value.
 * @returns The scene error.
 * @example
 * ```ts
 * shapeError("game.ui", "$.children[0].rect"); // { error: "shape", source: "game.ui", path: "$.children[0].rect" }
 * ```
 */
function shapeError(source: SceneError["source"], path: string): SceneError {
  return { error: "shape", source, path };
}

/**
 * The lookup key of a natural rect, for host matching by Box.
 *
 * @param rect - A rect.
 * @returns "x,y,w,h".
 * @example
 * ```ts
 * rectKey({ x: 55, y: 801, w: 970, h: 970 }); // "55,801,970,970"
 * ```
 */
function rectKey(rect: PageRect): string {
  return `${rect.x},${rect.y},${rect.w},${rect.h}`;
}

/**
 * Maps a rect through a frame.
 *
 * @param frame - Child units → parent units.
 * @param rect - A rect in child units.
 * @returns The rect in parent units.
 * @example
 * ```ts
 * applyFrame({ x: 55, y: 801, scale: 1 }, { x: 349, y: 55, w: 272, h: 272 }); // { x: 404, y: 856, w: 272, h: 272 }
 * ```
 */
function applyFrame(frame: Frame, rect: PageRect): PageRect {
  return {
    x: frame.x + frame.scale * rect.x,
    y: frame.y + frame.scale * rect.y,
    w: frame.scale * rect.w,
    h: frame.scale * rect.h
  };
}

/**
 * A rect in root units on the page: through the calibration when there is one.
 *
 * @param rect - A rect in root (reference) units.
 * @param calibration - The calibration, undefined to keep reference units.
 * @returns The rect to store on the node.
 * @example
 * ```ts
 * placeRect({ x: 100, y: 200, w: 40, h: 20 }, { scale: 0.5, x: 10, y: 30 }); // { x: 60, y: 130, w: 20, h: 10 }
 * ```
 */
function placeRect(rect: PageRect, calibration: Calibration | undefined): PageRect {
  return calibration === undefined ? rect : toPage(rect, calibration);
}

/**
 * Appends an item to the list of a key.
 *
 * @param lists - Key → items.
 * @param key - The key.
 * @param item - The item.
 */
function appendTo<Item>(lists: Map<string, Item[]>, key: string, item: Item): void {
  const list = lists.get(key);

  if (list === undefined) lists.set(key, [item]);
  else list.push(item);
}

/**
 * Adds one ui node (rule 1): path id, name key ?? type, drawn rect through the fit chain,
 * texture = style.nineSlice; registers it as a possible host under its natural rect.
 *
 * @param builder - The scene under construction.
 * @param visit - The ui node with its path and fit chain.
 * @example
 * ```ts
 * for (const visit of uiVisits(top)) addUiNode(builder, visit);
 * ```
 */
function addUiNode(builder: Builder, visit: UiVisit): void {
  // Where the node sits and how it is drawn.
  const { node, path, fits } = visit;
  const id = refId({ kind: "ui", path });
  const parent = visit.parent === undefined ? undefined : refId({ kind: "ui", path: visit.parent });
  const drawn = drawnRect(node.rect, fits);
  const texture = stringOf(node.style?.nineSlice);

  // The node, and the host its natural rect stands for.
  builder.drafts.set(id, {
    id,
    ref: { kind: "ui", path },
    name: node.key ?? node.type,
    type: node.type,
    parent,
    rect: placeRect(drawn, builder.calibration),
    texture,
    key: node.key,
    style: node.style,
    visible: isShown(node.style),
    entity: undefined
  });
  appendTo(builder.hosts, rectKey(node.rect), {
    id,
    key: node.key,
    drawn,
    scale: fitScaleOf(fits)
  });

  // Its texture and its place in the tree.
  if (texture !== undefined) builder.textures.add(texture);
  if (parent === undefined) builder.uiRoots.push(id);
  else appendTo(builder.children, parent, id);
}

/**
 * Tells whether a style or a display component draws: not when its `alpha` is 0 or its `visible`
 * is false. An absent value draws.
 *
 * @param value - A ui style or a display component value.
 * @returns False for alpha 0 or visible false.
 * @example
 * ```ts
 * isShown({ kind: "rect", w: 272, h: 272, alpha: 0 }); // false: merge-game's glow at rest
 * isShown(undefined); // true
 * ```
 */
function isShown(value: SceneNode["style"]): boolean {
  return value?.alpha !== 0 && value?.visible !== false;
}

/**
 * Tells whether an entity draws: its display component is shown (see `isShown`) and an enabled
 * `Alpha` filter does not fade it to 0.
 *
 * @param entity - The entity.
 * @returns False for an invisible entity.
 * @example
 * ```ts
 * isEntityShown(glow); // false: Shape { alpha: 0 }
 * isEntityShown(sawmill); // true
 * ```
 */
function isEntityShown(entity: EntityWire): boolean {
  const filter = componentOf(entity, "Alpha");
  const faded = filter !== undefined && filter.enabled !== false && filter.alpha === 0;
  return !faded && isShown(displayOf(entity)?.value);
}

/**
 * The display component of an entity, in priority order NineSlice, Sprite, Shape.
 *
 * @param entity - The entity.
 * @returns The display and its value, or undefined for a container.
 * @example
 * ```ts
 * displayOf(cell)?.display.type; // "NineSliceSprite"
 * ```
 */
function displayOf(entity: EntityWire): { display: Display; value: JsonObject } | undefined {
  for (const display of DISPLAYS) {
    const value = componentOf(entity, display.component);

    if (value !== undefined) return { display, value };
  }

  return undefined;
}

/**
 * The box of an entity in its own units: `{ x: −anchor.x·w, y: −anchor.y·h, w, h }`.
 *
 * @param entity - The entity.
 * @returns The box, or undefined without a display component with a size (a Text-only entity).
 */
function sizeBoxOf(entity: EntityWire): PageRect | undefined {
  const found = displayOf(entity);

  if (found === undefined) return undefined;

  const { display, value } = found;
  const w = numberOf(value[display.width]);
  const h = numberOf(value[display.height]);
  const anchor = display.anchored && isJsonObject(value.anchor) ? value.anchor : {};

  if (w === undefined || h === undefined) return undefined;

  return { x: -(numberOf(anchor.x) ?? 0) * w, y: -(numberOf(anchor.y) ?? 0) * h, w, h };
}

/**
 * The Transform of an entity as a frame.
 *
 * @param entity - The entity.
 * @returns `{ x, y, scale }` (scale 1 when absent), or undefined without x and y.
 */
function transformOf(entity: EntityWire): Frame | undefined {
  const transform = componentOf(entity, "Transform");
  const x = numberOf(transform?.x);
  const y = numberOf(transform?.y);

  if (x === undefined || y === undefined) return undefined;

  return { x, y, scale: numberOf(transform?.scale) ?? 1 };
}

/**
 * The entity id of an entity's Parent component.
 *
 * @param entity - The entity.
 * @returns The parent id, or undefined without a Parent.
 */
function parentOf(entity: EntityWire): number | undefined {
  return numberOf(componentOf(entity, "Parent")?.entity);
}

/**
 * Tells an entity of the ui plugin: its Box is the natural rect of the ui node it draws.
 *
 * @param entity - The entity.
 * @returns True for owner name "ui" (not a projection).
 */
function isUiOwned(entity: EntityWire): boolean {
  return entity.owner.kind !== PROJECTION && entity.owner.name === "ui";
}

/**
 * Composes two frames: inner units → outer's parent units.
 *
 * @param outer - The frame of the parent, undefined when it has no Transform.
 * @param inner - The frame so far, undefined once a Transform was missing.
 * @returns The composed frame, or undefined when either is undefined.
 * @example
 * ```ts
 * composeFrames({ x: 200, y: 0, scale: 1 }, { x: 10, y: 10, scale: 1 }); // { x: 210, y: 10, scale: 1 }
 * ```
 */
function composeFrames(outer: Frame | undefined, inner: Frame | undefined): Frame | undefined {
  if (outer === undefined || inner === undefined) return undefined;

  return {
    x: outer.x + outer.scale * inner.x,
    y: outer.y + outer.scale * inner.y,
    scale: outer.scale * inner.scale
  };
}

/**
 * Walks an entity's Parent chain up to the first ui-owned entity, composing the Transforms of
 * the entities passed (rule 3: an entity whose parent is an entity chains through it first).
 *
 * @param entity - The entity.
 * @param byId - Every entity by id.
 * @returns The chain; no host when the chain ends, breaks or loops.
 * @example
 * ```ts
 * chainOf(item, byId).hostEntity?.id; // 1048700
 * ```
 */
function chainOf(entity: EntityWire, byId: ReadonlyMap<number, EntityWire>): Chain {
  const seen = new Set([entity.id]);
  let frame: Frame | undefined = IDENTITY;
  let parentId = parentOf(entity);

  while (parentId !== undefined) {
    // A loop or a missing parent ends the walk without a host.
    if (seen.has(parentId)) return { hostEntity: undefined, frame: undefined, loops: true };

    const parent = byId.get(parentId);

    if (parent === undefined) break;
    if (isUiOwned(parent)) return { hostEntity: parent, frame, loops: false };

    // An entity on the way: its Transform carries the child into its parent's units.
    seen.add(parentId);
    frame = composeFrames(transformOf(parent), frame);
    parentId = parentOf(parent);
  }

  return { hostEntity: undefined, frame: undefined, loops: false };
}

/**
 * The host ui node of a ui-owned entity: the one whose natural rect equals the entity's Box. A tie
 * goes to the node keyed like the entity in game.projections; a tie without that key has no host.
 *
 * @param hosts - Natural rect → ui nodes.
 * @param hostEntity - The ui-owned entity at the end of a Parent chain.
 * @param addresses - The projection keys by entity id.
 * @returns The host, or undefined.
 * @example
 * ```ts
 * hostOf(builder.hosts, boardSlotEntity, addresses)?.id; // "ui:boardScreen/boardSlot"
 * ```
 */
function hostOf(
  hosts: ReadonlyMap<string, readonly Host[]>,
  hostEntity: EntityWire | undefined,
  addresses: ReadonlyMap<number, Address>
): Host | undefined {
  const box = hostEntity === undefined ? undefined : rectOf(hostEntity.components.Box);

  if (hostEntity === undefined || box === undefined) return undefined;

  const candidates = hosts.get(rectKey(box)) ?? [];

  if (candidates.length < 2) return candidates[0];

  const key = addresses.get(hostEntity.id)?.key;

  return key === undefined ? undefined : candidates.find(host => host.key === key);
}

/**
 * The rect of an entity in root units (rule 2 box, rule 3 host-to-root):
 * `root = hostDrawn.xy + local · (hostDrawn.w / host.rect.w)`.
 *
 * @param entity - The entity.
 * @param chain - Its Parent chain.
 * @param host - Its host, undefined when none was found.
 * @returns The rect, or undefined when it cannot be placed.
 */
function entityRect(
  entity: EntityWire,
  chain: Chain,
  host: Host | undefined
): PageRect | undefined {
  const own = transformOf(entity);
  const box = sizeBoxOf(entity);

  if (host === undefined || chain.frame === undefined) return undefined;
  if (own === undefined || box === undefined) return undefined;

  const inHost = applyFrame(chain.frame, applyFrame(own, box));

  return applyFrame({ x: host.drawn.x, y: host.drawn.y, scale: host.scale }, inHost);
}

/**
 * The node parent of a projection entity: the projection entity it is parented to, else its
 * host ui node; none for a looping chain.
 *
 * @param entity - The entity.
 * @param chain - Its Parent chain.
 * @param host - Its host.
 * @param byId - Every entity by id.
 * @returns The parent node id, or undefined for a root.
 */
function nodeParentOf(
  entity: EntityWire,
  chain: Chain,
  host: Host | undefined,
  byId: ReadonlyMap<number, EntityWire>
): string | undefined {
  if (chain.loops) return undefined;

  const parentId = parentOf(entity);
  const direct = parentId === undefined ? undefined : byId.get(parentId);

  if (direct?.owner.kind === PROJECTION) return refId({ kind: "entity", id: direct.id });

  return host?.id;
}

/**
 * The name of a projection entity: its key in game.projections[owner.name], else e<index>.
 *
 * @param entity - The entity.
 * @param addresses - The projection keys by entity id.
 * @returns The name.
 */
function nameOf(entity: EntityWire, addresses: ReadonlyMap<number, Address>): string {
  const address = addresses.get(entity.id);
  const isOwnKey = address !== undefined && address.projection === entity.owner.name;

  return isOwnKey ? address.key : `e${entity.index}`;
}

/**
 * The texture keys an entity draws: NineSlice.texture and Sprite.texture.
 *
 * @param entity - Any entity, ui-owned included.
 * @returns The keys, NineSlice first.
 */
function texturesOf(entity: EntityWire): string[] {
  const keys = [
    stringOf(componentOf(entity, "NineSlice")?.texture),
    stringOf(componentOf(entity, "Sprite")?.texture)
  ];

  return keys.filter(key => key !== undefined);
}

/**
 * Adds one projection entity (rules 2 and 3): name, type, texture, entity info, its rect when it
 * can be placed, and its node parent.
 *
 * @param builder - The scene under construction.
 * @param entity - A projection entity.
 * @param world - Every entity by id and the projection keys.
 * @returns Where it sits in the tree, with its Order.
 */
function addEntityNode(builder: Builder, entity: EntityWire, world: World): Placed {
  // Where the entity hangs and where it is drawn.
  const chain = chainOf(entity, world.byId);
  const host = hostOf(builder.hosts, chain.hostEntity, world.addresses);
  const rect = entityRect(entity, chain, host);
  const parent = nodeParentOf(entity, chain, host, world.byId);
  const id = refId({ kind: "entity", id: entity.id });

  // The node.
  builder.drafts.set(id, {
    id,
    ref: { kind: "entity", id: entity.id },
    name: nameOf(entity, world.addresses),
    type: displayOf(entity)?.display.type ?? CONTAINER,
    parent,
    rect: rect === undefined ? undefined : placeRect(rect, builder.calibration),
    texture: texturesOf(entity)[0],
    key: undefined,
    style: undefined,
    visible: isEntityShown(entity),
    entity: {
      id: entity.id,
      owner: entity.owner.name,
      components: [...Object.keys(entity.components), ...entity.skipped]
    }
  });

  return { id, parent, order: numberOf(componentOf(entity, "Order")?.value) ?? 0 };
}

/**
 * Links the placed entities to their parents after the ui children, sorted by Order (rule 5).
 *
 * @param builder - The scene under construction.
 * @param placed - The projection entities in entity order.
 * @returns The ids of the entities without a parent, in entity order.
 */
function linkEntities(builder: Builder, placed: readonly Placed[]): string[] {
  for (const { id, parent } of placed.toSorted((first, second) => first.order - second.order)) {
    if (parent !== undefined) appendTo(builder.children, parent, id);
  }

  return placed.filter(item => item.parent === undefined).map(item => item.id);
}

/**
 * Appends a node and its subtree in paint order: the node, then its children in order.
 *
 * @param id - The node id.
 * @param children - Parent id → child ids.
 * @param order - The paint order, filled in.
 */
function appendPainted(
  id: string,
  children: ReadonlyMap<string, readonly string[]>,
  order: string[]
): void {
  order.push(id);

  for (const child of children.get(id) ?? []) appendPainted(child, children, order);
}

/**
 * Builds the snapshot from the values read: the ui pass, the entity pass, the links and the
 * paint order (ui roots reversed, since the game lists the topmost popup first; then the
 * entities without a host).
 *
 * @param top - The top node of game.ui.
 * @param entities - game.entities.
 * @param addresses - The projection keys by entity id.
 * @param input - The frame and the calibration.
 * @returns The scene.
 * @example
 * ```ts
 * assemble(top, entities, addresses, { frame: 1841, calibration: undefined }).entityCount; // 101
 * ```
 */
function assemble(
  top: UiWire,
  entities: readonly EntityWire[],
  addresses: ReadonlyMap<number, Address>,
  input: Pick<SceneInput, "frame" | "calibration">
): SceneSnapshot {
  const builder: Builder = {
    calibration: input.calibration,
    drafts: new Map(),
    children: new Map(),
    hosts: new Map(),
    textures: new Set(),
    uiRoots: []
  };
  const world: World = { byId: new Map(entities.map(entity => [entity.id, entity])), addresses };
  const placed: Placed[] = [];

  // The ui tree first: every entity host is a ui node.
  for (const visit of uiVisits(top)) addUiNode(builder, visit);

  // Every entity's textures; the projection entities become nodes.
  for (const entity of entities) {
    for (const texture of texturesOf(entity)) builder.textures.add(texture);
    if (entity.owner.kind === PROJECTION) placed.push(addEntityNode(builder, entity, world));
  }

  // The tree links and the paint order, back to front.
  const entityRoots = linkEntities(builder, placed);
  const paintOrder: string[] = [];

  for (const root of [...builder.uiRoots.toReversed(), ...entityRoots]) {
    appendPainted(root, builder.children, paintOrder);
  }

  return {
    frame: input.frame,
    calibrated: input.calibration !== undefined,
    nodes: new Map(
      [...builder.drafts].map(([id, draft]) => [
        id,
        { ...draft, children: builder.children.get(id) ?? [] }
      ])
    ),
    roots: [...builder.uiRoots, ...entityRoots],
    paintOrder,
    referencedTextures: builder.textures,
    entityCount: entities.length
  };
}

/**
 * Builds the scene from the wire values of game.ui, game.entities and game.projections. A value
 * of the wrong shape gives a SceneError naming the source and the path; it never throws.
 *
 * @param input - The three values, the frame and the calibration.
 * @returns The scene, or the shape error.
 * @example
 * ```ts
 * const scene = buildScene({ ui, entities, projections, frame: 1841, calibration });
 * if ("error" in scene) ctx.log.warn("gameView: scene shape", scene);
 * ```
 */
export function buildScene(input: SceneInput): SceneSnapshot | SceneError {
  const top = readUi(input.ui);

  if (isShapePath(top)) return shapeError("game.ui", top.wrongAt);

  const entities = readEntities(input.entities);

  if (isShapePath(entities)) return shapeError("game.entities", entities.wrongAt);

  const addresses = readProjections(input.projections);

  if (isShapePath(addresses)) return shapeError("game.projections", addresses.wrongAt);

  return assemble(top, entities, addresses, input);
}
