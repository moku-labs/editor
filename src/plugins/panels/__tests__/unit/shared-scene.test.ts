import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Json } from "../../../registry/protocol";
import type {
  Calibration,
  PageRect,
  SceneError,
  SceneInput,
  SceneNode,
  SceneSnapshot
} from "../../shared/scene";
import {
  ancestorsOf,
  buildScene,
  calibrationFrom,
  calibrationTarget,
  clientFromPage,
  drawnRect,
  elementAt,
  isLayoutOnly,
  pageFromClient,
  parseTextureManifest,
  refId,
  toPage
} from "../../shared/scene";

// ─────────────────────────────────────────────────────────────────────────────
// The scene mapping (R8). Fixtures: two captures of merge-game (createScreenGame,
// inert renderer, the board at board/awaitIntent, then the settings popup open):
// game.ui, game.entities, game.projections and game.rect of a few keys, stored as
// compact JSON in .txt so tsc and lint never compile them.
// ─────────────────────────────────────────────────────────────────────────────

/** One capture of the three scene sources plus game.rect of some keys. */
type Capture = {
  readonly path: string;
  readonly ui: Json;
  readonly entities: Json;
  readonly projections: Json;
  readonly rects: Readonly<Record<string, PageRect>>;
};

function capture(name: string): Capture {
  const parsed: Capture = JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")
  );
  return parsed;
}

const BOARD = capture("scene-board.txt");
const SETTINGS = capture("scene-settings.txt");

function arrayOf(value: Json): Json[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value;
}

function objectOf(value: Json): { [key: string]: Json } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return value;
}

function input(overrides: Partial<SceneInput> = {}): SceneInput {
  return {
    ui: BOARD.ui,
    entities: BOARD.entities,
    projections: BOARD.projections,
    frame: 1841,
    calibration: undefined,
    ...overrides
  };
}

function isSceneError(value: SceneSnapshot | SceneError): value is SceneError {
  return "error" in value;
}

function sceneOf(overrides: Partial<SceneInput> = {}): SceneSnapshot {
  const built = buildScene(input(overrides));
  if (isSceneError(built)) throw new Error(`scene error: ${built.source} ${built.path}`);
  return built;
}

function errorOf(overrides: Partial<SceneInput>): SceneError {
  const built = buildScene(input(overrides));
  if (!isSceneError(built)) throw new Error("expected a scene error");
  return built;
}

function nodeOf(scene: SceneSnapshot, id: string): SceneNode {
  const node = scene.nodes.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

function rect(x: number, y: number, w: number, h: number): PageRect {
  return { x, y, w, h };
}

/** A ui node of the wire (an undefined key is absent, the way the bridge sends it). */
function ui(
  key: string | undefined,
  type: string,
  box: PageRect,
  children: Json[] = [],
  extra: { [key: string]: Json } = {}
): Json {
  const node: { [key: string]: Json } = {
    type,
    rect: { ...box },
    style: {},
    state: { pressed: false },
    children,
    ...extra
  };
  if (key !== undefined) node.key = key;
  return node;
}

/** A ui-owned entity with its Box. */
function uiEntity(id: number, box: PageRect, parent?: number): Json {
  const components: { [key: string]: Json } = { Box: { ...box } };
  if (parent !== undefined) components.Parent = { entity: parent };
  return {
    id,
    index: id,
    generation: 1,
    owner: { kind: "plugin", name: "ui" },
    components,
    skipped: []
  };
}

/** An entity of another owner: a projection view or a plain plugin entity. */
function entity(
  id: number,
  owner: { kind: string; name: string },
  components: { [key: string]: Json },
  skipped: string[] = []
): Json {
  return { id, index: id, generation: 1, owner, components, skipped };
}

function projected(id: number, name: string, components: { [key: string]: Json }): Json {
  return entity(id, { kind: "projection", name }, components);
}

/** The root entity of a popup: owned by the ui plugin, on layer ui, with an Order and a Tree. */
function popupRoot(id: number, order: number, tree: "skipped" | "components" = "skipped"): Json {
  const components: { [key: string]: Json } = { Layer: { name: "ui" }, Order: { value: order } };
  if (tree === "components") components.Tree = {};
  return entity(id, { kind: "plugin", name: "ui" }, components, tree === "skipped" ? ["Tree"] : []);
}

/** The root entity of a projection view that returned a tree: it carries Tree too. */
function viewRoot(id: number, name: string, layer: string): Json {
  return entity(id, { kind: "projection", name }, { Layer: { name: layer } }, ["Tree"]);
}

/** Several mounted roots the way game.ui sends them: under the keyless screen with a zero rect. */
function mounted(...roots: Json[]): Json {
  return ui(undefined, "screen", rect(0, 0, 0, 0), roots);
}

function transform(x: number, y: number, scale = 1): Json {
  return { x, y, rotation: 0, scale, pivot: { x: 0, y: 0 } };
}

// ─────────────────────────────────────────────────────────────────────────────
// A small fitted scene: a root, a slot drawn at fit 0.5 with an icon inside,
// and projection entities hosted by the slot (directly, chained through a
// projection entity, chained through a plain entity).
// ─────────────────────────────────────────────────────────────────────────────

const FIT_UI = ui("root", "screen", rect(0, 0, 1000, 1000), [
  ui("slot", "stack", rect(100, 100, 400, 400), [ui("icon", "image", rect(150, 150, 100, 100))], {
    fitScale: 0.5
  })
]);

const FIT_ENTITIES: Json = [
  uiEntity(1, rect(0, 0, 1000, 1000)),
  uiEntity(10, rect(100, 100, 400, 400), 1),
  projected(20, "fx", {
    Transform: transform(200, 0),
    Parent: { entity: 10 },
    Shape: { kind: "rect", w: 100, h: 50 }
  }),
  projected(21, "fx", {
    Transform: transform(100, 100, 2),
    Parent: { entity: 10 },
    Sprite: { texture: "fx.spark", width: 10, height: 10, anchor: { x: 0.5, y: 0.5 } }
  }),
  projected(30, "fx", {
    Transform: transform(10, 10),
    Parent: { entity: 20 },
    NineSlice: { texture: "fx.frame", width: 20, height: 20 }
  }),
  entity(
    40,
    { kind: "plugin", name: "board" },
    { Transform: transform(50, 50), Parent: { entity: 10 } }
  ),
  projected(41, "fx", {
    Transform: transform(0, 0),
    Parent: { entity: 40 },
    Shape: { w: 10, h: 10 }
  }),
  projected(50, "fx", {
    Transform: transform(0, 0),
    Parent: { entity: 51 },
    Shape: { w: 1, h: 1 }
  }),
  entity(
    51,
    { kind: "plugin", name: "loop" },
    { Transform: transform(0, 0), Parent: { entity: 50 } }
  ),
  projected(60, "fx", {
    Transform: transform(0, 0),
    Parent: { entity: 999 },
    Shape: { w: 1, h: 1 }
  }),
  projected(70, "fx", { Parent: { entity: 10 }, Shape: { w: 5, h: 5 } }),
  entity(80, { kind: "plugin", name: "board" }, { Parent: { entity: 10 } }),
  projected(81, "fx", { Transform: transform(0, 0), Parent: { entity: 80 }, Shape: { w: 5, h: 5 } })
];

const FIT_PROJECTIONS: Json = { fx: { burst: 20, spark: 21 } };

function fitScene(calibration?: Calibration): SceneSnapshot {
  return sceneOf({
    ui: FIT_UI,
    entities: FIT_ENTITIES,
    projections: FIT_PROJECTIONS,
    calibration
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Several roots, the way game 0.13 lists them (sortedRoots): the popup roots
// first, the topmost first, then the screen roots by scene layer, the bottom
// first. A sky on a lower layer under the home screen, and popups over both.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW = rect(0, 0, 100, 200);

const STAGE_SKY = ui("stageSky", "screen", WINDOW, [ui("skyArt", "image", WINDOW)]);

const HOME_SCREEN = ui("homeScreen", "screen", WINDOW, [
  ui("play", "button", rect(30, 150, 40, 20))
]);

/** A popup without a backdrop: one drawn panel. */
function popupUi(key: string, panel: string, box: PageRect): Json {
  return ui(key, "screen", WINDOW, [
    ui(panel, "image", box, [], { style: { nineSlice: "ui.panel" } })
  ]);
}

const CONFIRM_POPUP = popupUi("confirmPopup", "panel", rect(20, 100, 60, 60));
const POPUP_A = popupUi("popupA", "panelA", rect(20, 100, 60, 60));
const POPUP_B = popupUi("popupB", "panelB", rect(40, 140, 40, 40));

/** Inside the play button and under every popup panel. */
const PLAY_COVERED = { x: 50, y: 155 };
/** Inside the play button, under no popup panel. */
const PLAY_OPEN = { x: 50, y: 165 };
/** Inside the window, outside the button and every panel. */
const SKY_OPEN = { x: 50, y: 50 };

function rootsScene(tree: Json, entities: Json[]): SceneSnapshot {
  return sceneOf({ ui: tree, entities, projections: {} });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("drawnRect", () => {
  it("returns the natural rect when no link is fitted", () => {
    const natural = rect(10, 20, 30, 40);

    expect(drawnRect(natural, [])).toEqual(natural);
    expect(drawnRect(natural, [{ rect: rect(0, 0, 100, 100), fitScale: 1 }])).toEqual(natural);
  });

  it("scales about the centre of the fitted link: the game's {0,0,100,100} at 0.5", () => {
    const box = rect(0, 0, 100, 100);

    expect(drawnRect(box, [{ rect: box, fitScale: 0.5 }])).toEqual(rect(25, 25, 50, 50));
  });

  it("applies every fitted link, nearest first", () => {
    const natural = rect(40, 40, 20, 20);
    const fits = [
      { rect: natural, fitScale: 0.5 },
      { rect: rect(0, 0, 200, 200), fitScale: 1 },
      { rect: rect(0, 0, 200, 200), fitScale: 0.5 }
    ];

    expect(drawnRect(natural, fits)).toEqual(rect(72.5, 72.5, 5, 5));
  });
});

describe("refId", () => {
  it("prefixes ui paths and entity ids", () => {
    expect(refId({ kind: "ui", path: "column#0/hudRow/coins" })).toBe("ui:column#0/hudRow/coins");
    expect(refId({ kind: "entity", id: 1_048_580 })).toBe("entity:1048580");
  });
});

describe("buildScene: ui nodes", () => {
  it("builds node ids and paths from keys, the frame and the counts", () => {
    const scene = sceneOf();
    const pill = nodeOf(scene, "ui:boardScreen/hudRow/coinPill");

    expect(scene.frame).toBe(1841);
    expect(scene.calibrated).toBe(false);
    expect(scene.entityCount).toBe(104);
    expect([...scene.nodes.values()].filter(node => node.ref.kind === "ui")).toHaveLength(72);
    expect(pill.ref).toEqual({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(pill.name).toBe("coinPill");
    expect(pill.type).toBe("row");
    expect(pill.key).toBe("coinPill");
    expect(pill.texture).toBe("ui.hud-pill");
    expect(pill.parent).toBe("ui:boardScreen/hudRow");
    expect(pill.rect).toEqual(rect(235, 74, 290, 76));
    expect(pill.entity).toBeUndefined();
    expect(pill.style).toEqual(
      expect.objectContaining({ width: 290, height: 76, nineSlice: "ui.hud-pill" })
    );
    expect(pill.children).toEqual([
      "ui:boardScreen/hudRow/coinPill/coinPillIcon",
      "ui:boardScreen/hudRow/coinPill/coinPillText"
    ]);
  });

  it("names an unkeyed node type#index among its siblings", () => {
    const tree = ui(undefined, "column", rect(0, 0, 100, 100), [
      ui(undefined, "image", rect(0, 0, 10, 10)),
      ui("hudRow", "row", rect(0, 10, 100, 20), [ui(undefined, "text", rect(0, 10, 10, 10))]),
      ui(undefined, "text", rect(0, 40, 10, 10))
    ]);
    const scene = sceneOf({ ui: tree, entities: [], projections: {} });

    expect([...scene.nodes.keys()]).toEqual([
      "ui:column#0",
      "ui:column#0/image#0",
      "ui:column#0/hudRow",
      "ui:column#0/hudRow/text#0",
      "ui:column#0/text#2"
    ]);
    expect(nodeOf(scene, "ui:column#0").name).toBe("column");
    expect(nodeOf(scene, "ui:column#0").key).toBeUndefined();
    expect(nodeOf(scene, "ui:column#0").texture).toBeUndefined();
    expect(scene.roots).toEqual(["ui:column#0"]);
  });

  it("draws a node through its fit chain, the node itself included", () => {
    const scene = fitScene();

    expect(nodeOf(scene, "ui:root").rect).toEqual(rect(0, 0, 1000, 1000));
    expect(nodeOf(scene, "ui:root/slot").rect).toEqual(rect(200, 200, 200, 200));
    expect(nodeOf(scene, "ui:root/slot/icon").rect).toEqual(rect(225, 225, 50, 50));
  });

  it("unwraps the synthetic screen root: its children are the roots, painted in reverse", () => {
    const scene = sceneOf({
      ui: SETTINGS.ui,
      entities: SETTINGS.entities,
      projections: SETTINGS.projections
    });

    expect(scene.roots).toEqual(["ui:settingsScreen", "ui:boardScreen", "entity:1048640"]);
    expect([...scene.nodes.keys()].some(id => id.startsWith("ui:screen#"))).toBe(false);
    expect(nodeOf(scene, "ui:settingsScreen").parent).toBeUndefined();
    expect(scene.paintOrder.indexOf("ui:boardScreen")).toBe(0);
    expect(scene.paintOrder.indexOf("ui:infoBar")).toBe(-1);
    expect(scene.paintOrder.indexOf("ui:boardScreen/infoBar")).toBeLessThan(
      scene.paintOrder.indexOf("ui:settingsScreen")
    );
  });

  it("names unkeyed roots of the synthetic root by their index there", () => {
    const tree = ui(undefined, "screen", rect(0, 0, 0, 0), [
      ui("popup", "screen", rect(0, 0, 100, 100)),
      ui(undefined, "screen", rect(0, 0, 100, 100))
    ]);
    const scene = sceneOf({ ui: tree, entities: [popupRoot(900, 1)], projections: {} });

    expect(scene.roots).toEqual(["ui:popup", "ui:screen#1"]);
    expect(scene.paintOrder).toEqual(["ui:screen#1", "ui:popup"]);
  });

  it("gives an empty scene for the empty screen", () => {
    const scene = sceneOf({
      ui: ui(undefined, "screen", rect(0, 0, 0, 0)),
      entities: [],
      projections: {}
    });

    expect(scene.nodes.size).toBe(0);
    expect(scene.roots).toEqual([]);
    expect(scene.paintOrder).toEqual([]);
    expect(scene.referencedTextures.size).toBe(0);
    expect(scene.entityCount).toBe(0);
  });
});

describe("buildScene: projection entities", () => {
  it("names entities from projections and types them by their display component", () => {
    const scene = sceneOf();
    const item = nodeOf(scene, "entity:1048628");
    const cell = nodeOf(scene, "entity:3145728");
    const glow = nodeOf(scene, "entity:1048618");

    expect(item.ref).toEqual({ kind: "entity", id: 1_048_628 });
    expect(item.name).toBe("i1");
    expect(item.type).toBe("Sprite");
    expect(item.texture).toBe("board.item-wood-3");
    expect(item.key).toBeUndefined();
    expect(item.style).toBeUndefined();
    expect(item.entity).toEqual({
      id: 1_048_628,
      owner: "board.items",
      components: [
        "Layer",
        "Transform",
        "Order",
        "Parent",
        "Sprite",
        "Tappable",
        "Item",
        "Draggable",
        "DropTarget"
      ]
    });
    expect(cell.name).toBe("c1_0");
    expect(cell.type).toBe("NineSliceSprite");
    expect(cell.texture).toBe("board.cell");
    expect(glow.type).toBe("Graphics");
    expect(glow.texture).toBeUndefined();
  });

  it("names an entity without a projection key e<index>", () => {
    const scene = fitScene();

    expect(nodeOf(scene, "entity:20").name).toBe("burst");
    expect(nodeOf(scene, "entity:30").name).toBe("e30");
  });

  it("makes only projection entities nodes, never ui-owned or plugin entities", () => {
    const scene = sceneOf();
    const entities = [...scene.nodes.values()].filter(node => node.ref.kind === "entity");

    expect(entities).toHaveLength(32);
    expect(scene.nodes.has("entity:1048703")).toBe(false);
    // The coin counter is the text of the coin pill: an entity the ui plugin owns.
    expect(scene.nodes.has("entity:1048641")).toBe(false);
    expect(fitScene().nodes.has("entity:40")).toBe(false);
  });

  it("hosts an entity in the ui node whose natural rect equals its parent's Box", () => {
    const scene = sceneOf();

    expect(nodeOf(scene, "entity:1048628").parent).toBe("ui:boardScreen/boardSlot");
    expect(nodeOf(scene, "entity:1048628").rect).toEqual(rect(428.5, 880.5, 223, 223));
    expect(nodeOf(scene, "entity:3145728").rect).toEqual(rect(404, 856, 272, 272));
    expect(nodeOf(scene, "entity:1048618").rect).toEqual(rect(110, 856, 272, 272));
    expect(nodeOf(scene, "entity:1048627").rect).toEqual(rect(96, 842, 300, 300));
  });

  it("scales host-local units by the host's fit and the entity's own scale", () => {
    const scene = fitScene();

    expect(nodeOf(scene, "entity:20").parent).toBe("ui:root/slot");
    expect(nodeOf(scene, "entity:20").rect).toEqual(rect(300, 200, 50, 25));
    expect(nodeOf(scene, "entity:21").rect).toEqual(rect(245, 245, 10, 10));
  });

  it("chains through a parent projection entity first", () => {
    const scene = fitScene();
    const child = nodeOf(scene, "entity:30");

    expect(child.parent).toBe("entity:20");
    expect(child.rect).toEqual(rect(305, 205, 10, 10));
    expect(nodeOf(scene, "entity:20").children).toEqual(["entity:30"]);
  });

  it("chains through a plain entity that is not a node, hosted by the ui node", () => {
    const scene = fitScene();

    expect(nodeOf(scene, "entity:41").parent).toBe("ui:root/slot");
    expect(nodeOf(scene, "entity:41").rect).toEqual(rect(225, 225, 5, 5));
  });

  it("keeps a hosted entity listed but unplaced when a transform is missing", () => {
    const scene = fitScene();

    expect(nodeOf(scene, "entity:70").parent).toBe("ui:root/slot");
    expect(nodeOf(scene, "entity:70").rect).toBeUndefined();
    expect(nodeOf(scene, "entity:81").parent).toBe("ui:root/slot");
    expect(nodeOf(scene, "entity:81").rect).toBeUndefined();
  });

  it("lists an entity with no host as a root with rect undefined", () => {
    const scene = fitScene();

    for (const id of ["entity:50", "entity:60"]) {
      expect(nodeOf(scene, id).parent).toBeUndefined();
      expect(nodeOf(scene, id).rect).toBeUndefined();
      expect(scene.roots).toContain(id);
    }
  });

  it("leaves the projection roots and Text-only entities unplaced (merge-game hud)", () => {
    const scene = sceneOf();
    const hud = nodeOf(scene, "entity:1048640");
    const count = nodeOf(scene, "entity:1048636");

    expect(hud).toEqual(
      expect.objectContaining({ name: "hud", type: "Container", parent: undefined })
    );
    expect(hud.rect).toBeUndefined();
    expect(hud.entity?.components).toEqual(["Layer", "Tree"]);
    expect(scene.roots).toEqual(["ui:boardScreen", "entity:1048640"]);
    expect(count.rect).toBeUndefined();
    expect(count.entity?.components).toContain("Text");
  });

  it("breaks a Box tie with the projection key of the parent ui entity", () => {
    const entities = [
      ...arrayOf(BOARD.entities),
      projected(900, "test.fx", {
        Transform: transform(0, 0),
        Parent: { entity: 1_048_643 },
        Shape: { w: 10, h: 10 }
      }),
      projected(901, "test.fx", {
        Transform: transform(0, 0),
        Parent: { entity: 1_048_642 },
        Shape: { w: 10, h: 10 }
      })
    ];
    const scene = sceneOf({ entities });

    expect(nodeOf(scene, "entity:900").parent).toBe("ui:boardScreen/boardBackground");
    expect(nodeOf(scene, "entity:900").rect).toEqual(rect(0, 0, 10, 10));
    expect(nodeOf(scene, "entity:901").parent).toBe("ui:boardScreen");
  });

  it("does not guess a host when a Box tie has no key", () => {
    const hud = { ...objectOf(objectOf(BOARD.projections).hud ?? {}) };
    delete hud.boardBackground;
    const projections = { ...objectOf(BOARD.projections), hud };
    const entities = [
      ...arrayOf(BOARD.entities),
      projected(900, "test.fx", {
        Transform: transform(0, 0),
        Parent: { entity: 1_048_643 },
        Shape: { w: 10, h: 10 }
      })
    ];
    const scene = sceneOf({ entities, projections });

    expect(nodeOf(scene, "entity:900").parent).toBeUndefined();
    expect(nodeOf(scene, "entity:900").rect).toBeUndefined();
  });
});

describe("buildScene: paint order and textures", () => {
  it("paints parents before children and entities after their host, by Order", () => {
    const { paintOrder, nodes } = sceneOf();
    const at = (id: string): number => paintOrder.indexOf(id);

    expect(at("ui:boardScreen")).toBe(0);
    expect(at("ui:boardScreen/hudRow")).toBeLessThan(at("ui:boardScreen/hudRow/home"));
    expect(at("ui:boardScreen/boardSlot")).toBeLessThan(at("entity:3145728"));
    expect(at("entity:3145728")).toBeLessThan(at("entity:1048618"));
    expect(at("entity:1048618")).toBeLessThan(at("entity:1048630"));
    expect(at("entity:1048630")).toBeLessThan(at("entity:1048627"));
    expect(at("entity:1048627")).toBeLessThan(at("entity:1048628"));
    expect(at("entity:1048628")).toBeLessThan(at("entity:1048638"));
    expect(at("entity:1048638")).toBeLessThan(at("ui:boardScreen/infoBar"));
    expect(new Set(paintOrder).size).toBe(paintOrder.length);
    expect(paintOrder).toHaveLength(nodes.size);
    expect(nodeOf(sceneOf(), "ui:boardScreen/boardSlot").children[0]).toBe("entity:3145728");
    expect(nodeOf(sceneOf(), "ui:boardScreen/boardSlot").children.at(-1)).toBe("entity:1048638");
  });

  it("paints the screen roots in the game's order, then the popup roots reversed", () => {
    const scene = rootsScene(mounted(POPUP_B, POPUP_A, STAGE_SKY, HOME_SCREEN), [
      popupRoot(900, 1),
      popupRoot(901, 2)
    ]);

    expect(scene.paintOrder).toEqual([
      "ui:stageSky",
      "ui:stageSky/skyArt",
      "ui:homeScreen",
      "ui:homeScreen/play",
      "ui:popupA",
      "ui:popupA/panelA",
      "ui:popupB",
      "ui:popupB/panelB"
    ]);
  });

  it("keeps the roots of the snapshot in reader order, whatever the paint order", () => {
    const scene = rootsScene(mounted(POPUP_B, POPUP_A, STAGE_SKY, HOME_SCREEN), [
      popupRoot(900, 1),
      popupRoot(901, 2)
    ]);

    expect(scene.roots).toEqual(["ui:popupB", "ui:popupA", "ui:stageSky", "ui:homeScreen"]);
  });

  it("counts as popups only ui-owned entities with Tree, not a view root or a ui node", () => {
    const scene = rootsScene(mounted(STAGE_SKY, HOME_SCREEN), [
      viewRoot(1, "stageSky", "stage"),
      viewRoot(2, "homeScreen", "ui"),
      uiEntity(3, WINDOW)
    ]);

    expect(scene.paintOrder).toEqual([
      "ui:stageSky",
      "ui:stageSky/skyArt",
      "ui:homeScreen",
      "ui:homeScreen/play",
      "entity:1",
      "entity:2"
    ]);
  });

  it("paints every root as the game lists it when no entity is a popup root", () => {
    const scene = rootsScene(mounted(STAGE_SKY, HOME_SCREEN), []);

    expect(scene.paintOrder).toEqual([
      "ui:stageSky",
      "ui:stageSky/skyArt",
      "ui:homeScreen",
      "ui:homeScreen/play"
    ]);
  });

  it("clamps the popup count to the number of ui roots: two roots, then one root", () => {
    const entities = [popupRoot(900, 1), popupRoot(901, 2), popupRoot(902, 3)];
    const two = rootsScene(mounted(POPUP_B, POPUP_A), entities);
    const one = rootsScene(HOME_SCREEN, entities);

    expect(two.paintOrder).toEqual([
      "ui:popupA",
      "ui:popupA/panelA",
      "ui:popupB",
      "ui:popupB/panelB"
    ]);
    expect(one.paintOrder).toEqual(["ui:homeScreen", "ui:homeScreen/play"]);
  });

  it("collects every texture in use: ui nine-slices and all entities, ui-owned included", () => {
    const scene = sceneOf();

    expect([...scene.referencedTextures].toSorted()).toEqual([
      "board.bg-forest-meadow",
      "board.board-tray",
      "board.cell",
      "board.generator",
      "board.item-wood-1",
      "board.item-wood-2",
      "board.item-wood-3",
      "board.item-wood-4",
      "board.selection-ring-0",
      "orders.card-order",
      "orders.rope",
      "ui.badge-level",
      "ui.button-disabled",
      "ui.button-green",
      "ui.button-wood",
      "ui.decor-clothespin",
      "ui.hud-pill",
      "ui.icon-check",
      "ui.icon-coin",
      "ui.icon-energy",
      "ui.icon-gear",
      "ui.icon-home"
    ]);
    expect(fitScene().referencedTextures).toEqual(new Set(["fx.spark", "fx.frame"]));
  });

  it("applies the calibration to every rect", () => {
    const scene = sceneOf({ calibration: { scale: 0.5, x: 10, y: 20 } });

    expect(scene.calibrated).toBe(true);
    expect(nodeOf(scene, "ui:boardScreen").rect).toEqual(rect(10, 20, 540, 720));
    expect(nodeOf(scene, "entity:1048628").rect).toEqual(rect(224.25, 460.25, 111.5, 111.5));
    expect(nodeOf(fitScene({ scale: 2, x: 0, y: 0 }), "entity:20").rect).toEqual(
      rect(600, 400, 100, 50)
    );
  });
});

describe("buildScene: wrong shapes", () => {
  it("names game.ui and the path", () => {
    expect(errorOf({ ui: 42 })).toEqual({ error: "shape", source: "game.ui", path: "$" });
    expect(
      errorOf({ ui: { type: "screen", rect: rect(0, 0, 1, 1), children: [{ type: "row" }] } })
    ).toEqual({ error: "shape", source: "game.ui", path: "$.children[0].rect" });
    expect(errorOf({ ui: ui(undefined, "row", rect(0, 0, 1, 1), [], { key: 5 }) }).path).toBe(
      "$.key"
    );
    expect(errorOf({ ui: { type: "row", rect: rect(0, 0, 1, 1) } }).path).toBe("$.children");
    expect(errorOf({ ui: { type: 3, rect: rect(0, 0, 1, 1), children: [] } }).path).toBe("$.type");
  });

  it("names game.entities and the path", () => {
    expect(errorOf({ entities: {} })).toEqual({
      error: "shape",
      source: "game.entities",
      path: "$"
    });
    expect(errorOf({ entities: [{ id: 1, index: 0, owner: "x", components: {} }] })).toEqual({
      error: "shape",
      source: "game.entities",
      path: "$[0].owner"
    });
    expect(errorOf({ entities: [7] }).path).toBe("$[0]");
    expect(
      errorOf({
        entities: [{ id: "1", index: 0, owner: { kind: "a", name: "b" }, components: {} }]
      }).path
    ).toBe("$[0].id");
    expect(
      errorOf({ entities: [{ id: 1, index: 0, owner: { kind: "a", name: "b" }, components: [] }] })
        .path
    ).toBe("$[0].components");
  });

  it("names game.projections and the path", () => {
    expect(errorOf({ projections: [] })).toEqual({
      error: "shape",
      source: "game.projections",
      path: "$"
    });
    expect(errorOf({ projections: { hud: { coins: "x" } } }).path).toBe("$.hud.coins");
    expect(errorOf({ projections: { hud: 1 } }).path).toBe("$.hud");
  });
});

describe("calibration", () => {
  it("targets the first keyed ui node with a width, with its drawn rect", () => {
    expect(calibrationTarget(BOARD.ui)).toEqual({
      key: "boardScreen",
      drawn: rect(0, 0, 1080, 1440)
    });

    const tree = ui(undefined, "column", rect(0, 0, 100, 100), [
      ui(undefined, "image", rect(0, 0, 50, 50)),
      ui("zero", "text", rect(0, 0, 0, 10)),
      ui("slot", "stack", rect(10, 10, 40, 40), [], { fitScale: 0.5 })
    ]);

    expect(calibrationTarget(tree)).toEqual({ key: "slot", drawn: rect(20, 20, 20, 20) });
    expect(calibrationTarget(SETTINGS.ui)?.key).toBe("settingsScreen");
  });

  it("has no target without a keyed node or for a wrong shape", () => {
    expect(calibrationTarget(ui(undefined, "column", rect(0, 0, 10, 10)))).toBeUndefined();
    expect(calibrationTarget(42)).toBeUndefined();
  });

  it("derives scale and offset from one rect", () => {
    expect(calibrationFrom(rect(20, 40, 540, 720), rect(0, 0, 1080, 1440))).toEqual({
      scale: 0.5,
      x: 20,
      y: 40
    });
    expect(calibrationFrom(rect(60, 130, 100, 50), rect(100, 200, 200, 100))).toEqual({
      scale: 0.5,
      x: 10,
      y: 30
    });
  });

  it("keeps the scale at 1 for a drawn rect without a width", () => {
    expect(calibrationFrom(rect(5, 6, 0, 0), rect(1, 2, 0, 0))).toEqual({ scale: 1, x: 4, y: 4 });
  });

  it("maps a rect to the page", () => {
    expect(toPage(rect(100, 200, 40, 20), { scale: 0.5, x: 10, y: 30 })).toEqual(
      rect(60, 130, 20, 10)
    );
  });
});

describe("elementAt", () => {
  it("picks the last painted node that contains the point: the deepest wins", () => {
    const scene = sceneOf();

    expect(elementAt(scene, { x: 250, y: 100 })?.id).toBe(
      "ui:boardScreen/hudRow/coinPill/coinPillIcon"
    );
    expect(elementAt(scene, { x: 540, y: 990 })?.ref).toEqual({
      kind: "entity",
      id: 1_048_628
    });
  });

  it("lets the elements painted after a full-device root win, the root only where none does", () => {
    const tree = ui("root", "screen", rect(0, 0, 100, 100), [
      ui("button", "button", rect(10, 10, 20, 20))
    ]);
    const scene = sceneOf({ ui: tree, entities: [], projections: {} });

    expect(elementAt(scene, { x: 15, y: 15 })?.id).toBe("ui:root/button");
    expect(elementAt(scene, { x: 50, y: 50 })?.id).toBe("ui:root");
    expect(elementAt(sceneOf(), { x: 10, y: 10 })?.id).toBe("ui:boardScreen/boardBackground");
  });

  it("blocks everything painted before a full-device backdrop: the backdrop wins there", () => {
    const tree = ui("root", "screen", rect(0, 0, 100, 100), [
      ui("button", "button", rect(10, 10, 20, 20)),
      ui("veil", "stack", rect(0, 0, 99, 99), [ui("ok", "button", rect(40, 40, 20, 20))], {
        style: { fill: 0x1a_0f_08, alpha: 0.5 }
      })
    ]);
    const scene = sceneOf({ ui: tree, entities: [], projections: {} });

    expect(elementAt(scene, { x: 15, y: 15 })?.id).toBe("ui:root/veil");
    expect(elementAt(scene, { x: 45, y: 45 })?.id).toBe("ui:root/veil/ok");
  });

  it("looks through a full-screen layout column that draws nothing (merge-game homeTop)", () => {
    const tree = ui("root", "screen", rect(0, 0, 100, 100), [
      ui("middle", "column", rect(0, 20, 100, 60), [ui("play", "button", rect(30, 60, 40, 10))]),
      ui("top", "column", rect(0, 0, 100, 100), [ui("bar", "row", rect(0, 0, 100, 10))], {
        style: { position: "absolute", width: "100%", height: "100%" }
      })
    ]);
    const scene = sceneOf({ ui: tree, entities: [], projections: {} });

    expect(elementAt(scene, { x: 50, y: 65 })?.id).toBe("ui:root/middle/play");
    expect(elementAt(scene, { x: 50, y: 40 })?.id).toBe("ui:root/top");
    expect(elementAt(scene, { x: 50, y: 95 })?.id).toBe("ui:root/top");
  });

  it("isLayoutOnly: a ui layout type with no fill, stroke, nine-slice or shape", () => {
    const tree = ui("root", "screen", rect(0, 0, 100, 100), [
      ui("top", "column", rect(0, 0, 100, 100), [], { style: { padding: 8 } }),
      ui("veil", "stack", rect(0, 0, 100, 100), [], { style: { fill: 0x1a_0f_08 } }),
      ui("play", "button", rect(30, 60, 40, 10))
    ]);
    const scene = sceneOf({ ui: tree, entities: [], projections: {} });
    const node = (id: string): SceneNode => {
      const found = scene.nodes.get(id);
      if (found === undefined) throw new Error(`no node ${id}`);
      return found;
    };

    expect(isLayoutOnly(node("ui:root"))).toBe(true);
    expect(isLayoutOnly(node("ui:root/top"))).toBe(true);
    expect(isLayoutOnly(node("ui:root/veil"))).toBe(false);
    expect(isLayoutOnly(node("ui:root/play"))).toBe(false);
  });

  it("gives the settings backdrop, not the board's settings icon under it", () => {
    const scene = sceneOf({
      ui: SETTINGS.ui,
      entities: SETTINGS.entities,
      projections: SETTINGS.projections
    });

    expect(elementAt(scene, { x: 980, y: 112 })?.id).toBe("ui:settingsScreen/settingsBackdrop");
    expect(elementAt(sceneOf(), { x: 980, y: 112 })?.id).toBe(
      "ui:boardScreen/hudRow/settings/settingsIcon"
    );
  });

  it("finds the popup's element over the board", () => {
    const scene = sceneOf({
      ui: SETTINGS.ui,
      entities: SETTINGS.entities,
      projections: SETTINGS.projections
    });
    const hit = elementAt(scene, { x: 540, y: 700 });

    expect(hit?.ref.kind).toBe("ui");
    expect(hit?.id.startsWith("ui:settingsScreen/settingsBoard")).toBe(true);
  });

  it("looks through an invisible node: the item under merge-game's glow at rest wins", () => {
    // The glow (Shape alpha 0) is painted after the item over the whole cell.
    const tree = ui("root", "screen", rect(0, 0, 100, 100), [
      ui("slot", "stack", rect(0, 0, 100, 90))
    ]);
    const glow = { kind: "rect", w: 40, h: 40, fill: 0xff_ff_ff, fillAlpha: 0, alpha: 0 };
    const entities = [
      uiEntity(1, rect(0, 0, 100, 100)),
      uiEntity(2, rect(0, 0, 100, 90), 1),
      projected(10, "board.items", {
        Transform: transform(10, 10),
        Parent: { entity: 2 },
        Order: { value: 1 },
        Sprite: { texture: "item", width: 20, height: 20, anchor: { x: 0, y: 0 } }
      }),
      projected(11, "board.glows", {
        Transform: transform(0, 0),
        Parent: { entity: 2 },
        Order: { value: 2 },
        Shape: glow
      }),
      projected(12, "board.glows", {
        Transform: transform(50, 0),
        Parent: { entity: 2 },
        Order: { value: 3 },
        Shape: { ...glow, alpha: 1 }
      }),
      projected(13, "board.glows", {
        Transform: transform(0, 50),
        Parent: { entity: 2 },
        Order: { value: 4 },
        Shape: { kind: "rect", w: 40, h: 40 },
        Alpha: { alpha: 0, enabled: true, order: 0 }
      })
    ];
    const scene = sceneOf({ ui: tree, entities, projections: {} });

    expect(nodeOf(scene, "entity:11").visible).toBe(false);
    expect(nodeOf(scene, "entity:13").visible).toBe(false);
    expect(nodeOf(scene, "entity:10").visible).toBe(true);
    expect(elementAt(scene, { x: 15, y: 15 })?.id).toBe("entity:10");
    expect(elementAt(scene, { x: 35, y: 35 })?.id).toBe("ui:root/slot");
    expect(elementAt(scene, { x: 55, y: 5 })?.id).toBe("entity:12");
    expect(elementAt(scene, { x: 5, y: 55 })?.id).toBe("ui:root/slot");
  });

  it("looks through a ui node with alpha 0 or visible false", () => {
    const tree = ui("root", "screen", rect(0, 0, 100, 100), [
      ui("button", "button", rect(10, 10, 20, 20), [], { style: { fill: 0x10_20_30 } }),
      ui("faded", "button", rect(0, 0, 50, 50), [], { style: { fill: 0x10_20_30, alpha: 0 } }),
      ui("hidden", "image", rect(0, 0, 50, 50), [], { style: { visible: false } })
    ]);
    const scene = sceneOf({ ui: tree, entities: [], projections: {} });

    expect(nodeOf(scene, "ui:root/faded").visible).toBe(false);
    expect(nodeOf(scene, "ui:root/hidden").visible).toBe(false);
    expect(nodeOf(scene, "ui:root/button").visible).toBe(true);
    expect(elementAt(scene, { x: 15, y: 15 })?.id).toBe("ui:root/button");
  });

  it("never gives a board glow at rest: every cell gives what is drawn on it", () => {
    const scene = sceneOf();
    const glows = [...scene.nodes.values()].filter(node => node.entity?.owner === "board.glows");

    expect(glows).toHaveLength(9);
    for (const glow of glows) {
      const box = glow.rect ?? rect(0, 0, 0, 0);
      const hit = elementAt(scene, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
      expect(glow.visible).toBe(false);
      expect(hit?.entity?.owner).not.toBe("board.glows");
      expect(hit?.name).toMatch(/^(c\d_\d|i\d)$/);
    }
  });

  it("finds nothing outside every rect", () => {
    expect(elementAt(sceneOf(), { x: 2000, y: 3000 })).toBeUndefined();
    expect(elementAt(fitScene(), { x: 0, y: 0 })?.id).toBe("ui:root");
  });
});

describe("elementAt: several ui roots", () => {
  it("gives the button of the upper screen root, not the full-window image of the root under it", () => {
    const scene = rootsScene(mounted(STAGE_SKY, HOME_SCREEN), [
      viewRoot(1, "stageSky", "stage"),
      viewRoot(2, "homeScreen", "ui")
    ]);

    expect(elementAt(scene, PLAY_OPEN)?.id).toBe("ui:homeScreen/play");
  });

  it("looks through the upper screen root where it only lays out: the image under it wins", () => {
    const scene = rootsScene(mounted(STAGE_SKY, HOME_SCREEN), []);

    expect(isLayoutOnly(nodeOf(scene, "ui:homeScreen"))).toBe(true);
    expect(elementAt(scene, SKY_OPEN)?.id).toBe("ui:stageSky/skyArt");
  });

  it("gives the popup's panel over the button and the sky (Tree in skipped)", () => {
    const scene = rootsScene(mounted(CONFIRM_POPUP, STAGE_SKY, HOME_SCREEN), [popupRoot(900, 1)]);

    expect(elementAt(scene, PLAY_COVERED)?.id).toBe("ui:confirmPopup/panel");
  });

  it("gives the popup's panel over the button and the sky (Tree in components)", () => {
    const scene = rootsScene(mounted(CONFIRM_POPUP, STAGE_SKY, HOME_SCREEN), [
      popupRoot(900, 1, "components")
    ]);

    expect(elementAt(scene, PLAY_COVERED)?.id).toBe("ui:confirmPopup/panel");
  });

  it("gives the button beside the popup's panel, not the sky: the screens keep their order", () => {
    const scene = rootsScene(mounted(CONFIRM_POPUP, STAGE_SKY, HOME_SCREEN), [popupRoot(900, 1)]);

    expect(elementAt(scene, PLAY_OPEN)?.id).toBe("ui:homeScreen/play");
    expect(elementAt(scene, SKY_OPEN)?.id).toBe("ui:stageSky/skyArt");
  });

  it("gives the element of the topmost of two popups where both cover the point", () => {
    const scene = rootsScene(mounted(POPUP_B, POPUP_A, STAGE_SKY, HOME_SCREEN), [
      popupRoot(900, 1),
      popupRoot(901, 2)
    ]);

    expect(elementAt(scene, PLAY_COVERED)?.id).toBe("ui:popupB/panelB");
    expect(elementAt(scene, { x: 25, y: 110 })?.id).toBe("ui:popupA/panelA");
  });
});

describe("frame transforms", () => {
  it("round-trips client and page px at scale 0.5", () => {
    const box = { left: 100, top: 50, scale: 0.5 };
    const page = pageFromClient({ x: 300, y: 200 }, box);

    expect(page).toEqual({ x: 400, y: 300 });
    expect(clientFromPage(page, box)).toEqual({ x: 300, y: 200 });
    expect(pageFromClient(clientFromPage({ x: 141, y: 402 }, box), box)).toEqual({
      x: 141,
      y: 402
    });
  });
});

describe("ancestorsOf", () => {
  it("lists the ancestors root first", () => {
    const scene = sceneOf();

    expect(ancestorsOf(scene, "ui:boardScreen/hudRow/coinPill/coinPillIcon")).toEqual([
      "ui:boardScreen",
      "ui:boardScreen/hudRow",
      "ui:boardScreen/hudRow/coinPill"
    ]);
    expect(ancestorsOf(scene, "entity:1048628")).toEqual([
      "ui:boardScreen",
      "ui:boardScreen/boardSlot"
    ]);
    expect(ancestorsOf(fitScene(), "entity:30")).toEqual(["ui:root", "ui:root/slot", "entity:20"]);
  });

  it("is empty for a root and an unknown id", () => {
    const scene = sceneOf();

    expect(ancestorsOf(scene, "ui:boardScreen")).toEqual([]);
    expect(ancestorsOf(scene, "ui:nothing")).toEqual([]);
  });
});

describe("parseTextureManifest", () => {
  const manifest = {
    version: 1,
    bundles: {
      board: {
        feature: "board",
        tier: "scene",
        mb: 10.01,
        files: [
          {
            key: "board.bg",
            path: "features/board/assets/bg.webp",
            width: 1024,
            height: 1536,
            mb: 6
          },
          {
            key: "board.cell",
            path: "features/board/assets/cell.webp",
            kind: "texture",
            width: 1024,
            height: 1024,
            mb: 4
          },
          { key: "board.merge", path: "features/board/assets/merge.mp3", kind: "audio", mb: 0.01 }
        ]
      },
      ui: {
        feature: "ui",
        tier: "boot",
        mb: 1.245,
        files: [
          {
            key: "ui.font-body",
            path: "features/ui/assets/font-body.fnt",
            kind: "font",
            mb: 1,
            pages: [{ path: "features/ui/assets/font-body.png", width: 512, height: 512, mb: 1 }]
          },
          {
            key: "orders.card-order",
            path: "features/orders/assets/card-order{nine=40,40,40,40}.webp",
            width: 214,
            height: 300,
            mb: 0.245,
            nine: { left: 40, top: 40, right: 40, bottom: 40 }
          },
          { key: "ui.broken", path: "features/ui/assets/broken.webp", mb: 0 }
        ]
      },
      odd: "not a bundle"
    }
  };

  it("keeps textures, drops fonts and audio, and computes gpuMb", () => {
    const catalogue = parseTextureManifest(JSON.stringify(manifest), "manifest.json");

    expect(catalogue?.path).toBe("manifest.json");
    expect([...(catalogue?.textures.keys() ?? [])]).toEqual([
      "board.bg",
      "board.cell",
      "orders.card-order"
    ]);
    expect(catalogue?.textures.get("board.cell")).toEqual({
      key: "board.cell",
      bundle: "board",
      width: 1024,
      height: 1024,
      gpuMb: 4,
      fileMb: 4
    });
    expect(catalogue?.textures.get("board.cell")?.gpuMb.toFixed(2)).toBe("4.00");
    expect(catalogue?.textures.get("board.bg")?.gpuMb).toBe(6);
    expect(catalogue?.textures.get("orders.card-order")).toEqual({
      key: "orders.card-order",
      bundle: "ui",
      width: 214,
      height: 300,
      gpuMb: 0.24,
      fileMb: 0.245
    });
  });

  it("summarises bundles: tier, file count and file MB", () => {
    const catalogue = parseTextureManifest(JSON.stringify(manifest), "manifest.json");

    expect([...(catalogue?.bundles.entries() ?? [])]).toEqual([
      ["board", { tier: "scene", files: 3, fileMb: 10.01 }],
      ["ui", { tier: "boot", files: 3, fileMb: 1.245 }]
    ]);
  });

  it("is undefined for invalid JSON, another version or no bundles", () => {
    expect(parseTextureManifest("{", "manifest.json")).toBeUndefined();
    expect(
      parseTextureManifest(JSON.stringify({ ...manifest, version: 2 }), "manifest.json")
    ).toBeUndefined();
    expect(parseTextureManifest(JSON.stringify({ version: 1 }), "manifest.json")).toBeUndefined();
    expect(parseTextureManifest("[]", "manifest.json")).toBeUndefined();
  });
});

describe("the build spike on merge-game (rules 2–4)", () => {
  it("captures the board at board/awaitIntent and the settings popup", () => {
    expect(BOARD.path).toBe("board/awaitIntent");
    expect(SETTINGS.path).toBe("board/settings/open");
  });

  it("rule 2: every projection entity is a node, ui-owned entities are not", () => {
    const scene = sceneOf();
    const owners = new Set(
      [...scene.nodes.values()].flatMap(node => (node.entity ? [node.entity.owner] : []))
    );

    expect(owners).toEqual(
      new Set([
        "board.cells",
        "board.glows",
        "board.selection",
        "board.items",
        "board.generators",
        "board.badges",
        "board.steam",
        "hud"
      ])
    );
  });

  it("rule 3: the board views sit in boardSlot, the cells on their 3×3 grid", () => {
    const scene = sceneOf();
    const board = [...scene.nodes.values()].filter(node => node.entity?.owner.startsWith("board."));
    const cells = board.filter(node => node.entity?.owner === "board.cells");

    expect(board).toHaveLength(31);
    expect(new Set(board.map(node => node.parent))).toEqual(new Set(["ui:boardScreen/boardSlot"]));
    expect(new Set(cells.map(node => node.rect?.x))).toEqual(new Set([110, 404, 698]));
    expect(new Set(cells.map(node => node.rect?.y))).toEqual(new Set([856, 1150, 1444]));
    expect(new Set(cells.map(node => `${node.rect?.w}x${node.rect?.h}`))).toEqual(
      new Set(["272x272"])
    );
  });

  it("rule 4: the inert renderer calibrates to identity and rects equal game.rect", () => {
    const target = calibrationTarget(BOARD.ui);
    const page = BOARD.rects[target?.key ?? ""];
    if (target === undefined || page === undefined) throw new Error("no calibration target");
    const calibration = calibrationFrom(page, target.drawn);
    const scene = sceneOf({ calibration });

    expect(calibration).toEqual({ scale: 1, x: 0, y: 0 });
    expect(nodeOf(scene, "ui:boardScreen/hudRow/settings").rect).toEqual(BOARD.rects.settings);

    const popupTarget = calibrationTarget(SETTINGS.ui);
    const popupPage = SETTINGS.rects[popupTarget?.key ?? ""];
    if (popupTarget === undefined || popupPage === undefined) throw new Error("no target");
    const popup = sceneOf({
      ui: SETTINGS.ui,
      entities: SETTINGS.entities,
      projections: SETTINGS.projections,
      calibration: calibrationFrom(popupPage, popupTarget.drawn)
    });

    expect(nodeOf(popup, "ui:settingsScreen/settingsBoard").rect).toEqual(
      SETTINGS.rects.settingsBoard
    );
  });
});

describe("types", () => {
  it("returns a snapshot or a shape error, never throws", () => {
    expectTypeOf(buildScene).returns.toEqualTypeOf<SceneSnapshot | SceneError>();
    expectTypeOf<SceneError["source"]>().toEqualTypeOf<
      "game.ui" | "game.entities" | "game.projections"
    >();
  });
});
