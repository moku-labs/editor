import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadMergeGame } from "../../../../../tests/fixtures/merge-game";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import type { Json } from "../../../registry/protocol";
import type { GameLike, RegistryApi } from "../../../registry/types";
import type { PageRect, SceneInput, SceneNode, SceneSnapshot } from "../../shared/scene";
import { buildScene, calibrationFrom, calibrationTarget, elementAt } from "../../shared/scene";

// ─────────────────────────────────────────────────────────────────────────────
// Build spike of scene/ (R8) on the live merge game: createScreenGame with the
// inert renderer, headless assets (no io: every bundle counts as loaded, the
// way the fixtures were captured), the timber player with two wood items.
// The agent registry reads game.ui, game.entities, game.projections and
// game.rect at home, at board/awaitIntent and at board/settings/open. The
// scene rules 2–4 run on those values, and the values must still match the
// stored fixtures of the unit tests (ids and animation fields aside).
// ─────────────────────────────────────────────────────────────────────────────

/** The screen game as this test drives it. */
type ScreenApp = GameLike & {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly flow: { run(): Promise<unknown>; state(): { readonly path: string } };
  readonly time: { step(ms: number): void };
};

/** A JSON object. */
type JsonObject = { [key: string]: Json };

/** The game's starting player, as far as this test changes it. */
type StartingPlayer = JsonObject & {
  readonly merge: JsonObject & { readonly board: JsonObject; readonly energy: JsonObject };
};

/** One capture of the three scene sources plus game.rect of some keys. */
type Capture = {
  readonly path: string;
  readonly ui: Json;
  readonly entities: Json;
  readonly projections: Json;
  readonly rects: Readonly<Record<string, PageRect>>;
};

const GAME_DIR = path.resolve("../game/tests/integration/merge-game");

/** The device of the inert renderer: one reference unit is one page px. */
const DEVICE = { w: 1080, h: 1440 };

const IDENTITY = { scale: 1, x: 0, y: 0 };

const agentCore = createAgentCore(agentCoreConfig, { plugins: [registryPlugin] });

let game: ScreenApp;
let registry: RegistryApi;
let home: Capture;
let board: Capture;
let settings: Capture;

// ── JSON helpers ─────────────────────────────────────────────────────────────

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectOf(value: Json | undefined): JsonObject {
  if (!isObject(value)) throw new Error("expected an object");
  return value;
}

function arrayOf(value: Json | undefined): Json[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value;
}

function numberOf(value: Json | undefined): number {
  if (typeof value !== "number") throw new TypeError("expected a number");
  return value;
}

function pageRect(value: Json): PageRect {
  const box = objectOf(value);
  return { x: numberOf(box.x), y: numberOf(box.y), w: numberOf(box.w), h: numberOf(box.h) };
}

// ── the live game ────────────────────────────────────────────────────────────

async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    game.time.step(16);
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/**
 * Taps a keyed element and steps frames until the flow reaches a path, then `settle` more, and on
 * until `atLeast` frames passed since the tap (the frame counts the fixtures were captured at).
 */
async function tapUntil(key: string, target: string, settle: number, atLeast = 0): Promise<void> {
  const tapped = registry.command("game.tap")?.run({ key });
  let stepped = 0;
  for (; stepped < 200 && game.flow.state().path !== target; stepped += 1) await frames(1);
  await frames(settle);
  await frames(Math.max(0, atLeast - stepped - settle));
  await tapped;
}

function read(id: string, input: Json = {}): Json {
  const source = registry.source(id);
  if (source === undefined) throw new Error(`no source ${id}`);
  return source.read(input);
}

/** Reads the scene sources, and game.rect of some keys and of the calibration target. */
function captureLive(keys: readonly string[]): Capture {
  const ui = read("game.ui");
  const target = calibrationTarget(ui)?.key;
  const rects: Record<string, PageRect> = {};
  for (const key of target === undefined ? keys : [...keys, target]) {
    rects[key] = pageRect(read("game.rect", { key }));
  }
  return {
    path: game.flow.state().path,
    ui,
    entities: read("game.entities"),
    projections: read("game.projections"),
    rects
  };
}

async function importGame<T>(file: string): Promise<T> {
  const module: T = await import(/* @vite-ignore */ pathToFileURL(path.join(GAME_DIR, file)).href);
  return module;
}

/** The timber player: a plank and a twig on the board, seven energy counted at the start. */
async function timberPlayer(): Promise<JsonObject> {
  const { startingPlayer } = await importGame<{ startingPlayer: StartingPlayer }>("state.ts");
  const { startMoment } = await importGame<{ startMoment: number }>("game.ts");
  const { merge } = startingPlayer;
  return {
    ...startingPlayer,
    merge: {
      ...merge,
      board: {
        ...merge.board,
        items: [
          { id: "i1", chain: "wood", level: 3, cell: "c1_0" },
          { id: "i2", chain: "wood", level: 1, cell: "c2_1" }
        ]
      },
      energy: { ...merge.energy, value: 7, countedAt: startMoment },
      nextItemId: 3
    }
  };
}

beforeAll(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const manifest: Json = JSON.parse(readFileSync(path.join(GAME_DIR, "manifest.json"), "utf8"));
  const fixture = await loadMergeGame();
  const create = fixture.createScreenGame as unknown as (options: {
    player: JsonObject;
    manifest: Json;
  }) => { app: ScreenApp };
  game = create({ player: await timberPlayer(), manifest }).app;
  await game.start();
  game.flow.run().catch(() => undefined);
  await frames(6);

  const agent = agentCore.createApp({ pluginConfigs: { registry: { game } } });
  await agent.start();
  registry = agent.registry;

  home = captureLive(["play"]);
  await tapUntil("play", "board/awaitIntent", 6);
  board = captureLive(["settings", "boardScreen", "boardSlot"]);
  await tapUntil("settings", "board/settings/open", 0, 30);
  settings = captureLive(["settingsScreen", "settingsBoard"]);
});

afterAll(async () => {
  await game?.stop();
  vi.unstubAllGlobals();
});

// ── scene helpers ────────────────────────────────────────────────────────────

function sceneOf(capture: Capture, overrides: Partial<SceneInput> = {}): SceneSnapshot {
  const built = buildScene({
    ui: capture.ui,
    entities: capture.entities,
    projections: capture.projections,
    frame: 1,
    calibration: undefined,
    ...overrides
  });
  if ("error" in built) throw new Error(`scene error: ${built.source} ${built.path}`);
  return built;
}

function nodeOf(scene: SceneSnapshot, id: string): SceneNode {
  const node = scene.nodes.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

function keyedNode(scene: SceneSnapshot, key: string): SceneNode {
  const node = [...scene.nodes.values()].find(each => each.key === key);
  if (node === undefined) throw new Error(`no node keyed ${key}`);
  return node;
}

/** The live entity id of a projection key. */
function idOf(capture: Capture, projection: string, key: string): number {
  return numberOf(objectOf(objectOf(capture.projections)[projection])[key]);
}

function entityNode(scene: SceneSnapshot, capture: Capture, projection: string, key: string) {
  return nodeOf(scene, `entity:${idOf(capture, projection, key)}`);
}

function entityOf(capture: Capture, id: number): JsonObject {
  const found = arrayOf(capture.entities).find(each => objectOf(each).id === id);
  return objectOf(found);
}

function projected(id: number, parent: number): Json {
  return {
    id,
    index: id,
    generation: 1,
    owner: { kind: "projection", name: "spike.fx" },
    components: {
      Transform: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
      Parent: { entity: parent },
      Shape: { w: 10, h: 10 }
    },
    skipped: []
  };
}

/** Rects of fitted screens carry float noise in the last digits. */
function expectRect(actual: PageRect | undefined, expected: PageRect | undefined): void {
  if (actual === undefined || expected === undefined) throw new Error("no rect");
  for (const side of ["x", "y", "w", "h"] as const) {
    expect(actual[side]).toBeCloseTo(expected[side], 6);
  }
}

function center(box: PageRect | undefined): { x: number; y: number } {
  if (box === undefined) throw new Error("no rect");
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

// ── structure: the capture without entity ids and animation fields ───────────

function storedCapture(name: string): Capture {
  const parsed: Capture = JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")
  );
  return parsed;
}

/**
 * Drops what animations drive: the card swing (rotation), the transform of an entity that plays an
 * Animation (the settings board drops in) and the selection ring's flipbook frame.
 */
function stillComponents(components: JsonObject): JsonObject {
  const still: JsonObject = { ...components };
  if (isObject(still.Transform)) {
    still.Transform =
      still.Animation === undefined
        ? without(still.Transform, "rotation")
        : without(still.Transform, "x", "y", "rotation", "scale");
  }
  if (still.SelectionRing !== undefined && isObject(still.Sprite)) {
    still.Sprite = without(still.Sprite, "texture");
  }
  return still;
}

function without(value: JsonObject, ...keys: string[]): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/**
 * The entities by a stable label: `<projection>.<key>`, else `<owner kind>:<owner name>#<n>` in
 * list order; Parent references follow the labels.
 */
function entityStructure(capture: Capture): Record<string, Json> {
  const labels = new Map<number, string>();
  for (const [projection, keys] of Object.entries(objectOf(capture.projections))) {
    for (const [key, id] of Object.entries(objectOf(keys))) {
      labels.set(numberOf(id), `${projection}.${key}`);
    }
  }
  const counts = new Map<string, number>();
  const entities = arrayOf(capture.entities).map(each => objectOf(each));
  for (const entity of entities) {
    const id = numberOf(entity.id);
    if (labels.has(id)) continue;
    const owner = objectOf(entity.owner);
    const prefix = `${String(owner.kind)}:${String(owner.name)}`;
    const count = counts.get(prefix) ?? 0;
    counts.set(prefix, count + 1);
    labels.set(id, `${prefix}#${count}`);
  }
  const structure: Record<string, Json> = {};
  for (const entity of entities) {
    const components = stillComponents(objectOf(entity.components));
    if (isObject(components.Parent)) {
      const parent = numberOf(components.Parent.entity);
      components.Parent = { entity: labels.get(parent) ?? `unknown:${parent}` };
    }
    structure[labels.get(numberOf(entity.id)) ?? ""] = {
      owner: entity.owner ?? {},
      components,
      skipped: entity.skipped ?? []
    };
  }
  return structure;
}

function structureOf(capture: Capture, rectKeys: readonly string[]) {
  const projections = Object.fromEntries(
    Object.entries(objectOf(capture.projections)).map(([name, keys]) => [
      name,
      Object.keys(objectOf(keys)).toSorted()
    ])
  );
  return {
    path: capture.path,
    ui: capture.ui,
    projections,
    entities: entityStructure(capture),
    rects: Object.fromEntries(rectKeys.map(key => [key, capture.rects[key]]))
  };
}

function uiIds(scene: SceneSnapshot): string[] {
  return [...scene.nodes.keys()].filter(id => id.startsWith("ui:"));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("the stored fixtures are the live game", () => {
  it.each([
    ["scene-board.txt", () => board],
    ["scene-settings.txt", () => settings]
  ])("%s matches the live capture in path, ui, projection keys, entities and rects", (name, live) => {
    const stored = storedCapture(name);
    const keys = Object.keys(stored.rects);

    expect(structureOf(live(), keys)).toEqual(structureOf(stored, keys));
  });

  it("builds the same ui nodes and entity counts from the live values as from the fixtures", () => {
    for (const [name, live] of [
      ["scene-board.txt", board],
      ["scene-settings.txt", settings]
    ] as const) {
      const fromLive = sceneOf(live);
      const fromStored = sceneOf(storedCapture(name));
      expect(uiIds(fromLive)).toEqual(uiIds(fromStored));
      expect(fromLive.nodes.size).toBe(fromStored.nodes.size);
      expect(fromLive.entityCount).toBe(fromStored.entityCount);
    }
  });
});

describe("scene on the live board (board/awaitIntent)", () => {
  it("names ui nodes by their key paths", () => {
    const scene = sceneOf(board);

    expect(board.path).toBe("board/awaitIntent");
    expect(scene.calibrated).toBe(false);
    expect(scene.entityCount).toBe(101);
    expect(keyedNode(scene, "boardSlot").id).toBe("ui:boardScreen/boardSlot");
    expect(keyedNode(scene, "settings").id).toBe("ui:boardScreen/hudRow/settings");
    expect(nodeOf(scene, "ui:boardScreen/hudRow/coinPill")).toMatchObject({
      ref: { kind: "ui", path: "boardScreen/hudRow/coinPill" },
      type: "row",
      texture: "ui.hud-pill",
      parent: "ui:boardScreen/hudRow"
    });
  });

  it("finds play on the home screen", () => {
    const scene = sceneOf(home);
    const play = keyedNode(scene, "play");

    expect(play.ref.kind).toBe("ui");
    expectRect(play.rect, home.rects.play);
  });

  it("hosts the board items and cells under boardSlot, with rects", () => {
    const scene = sceneOf(board);
    const i1 = entityNode(scene, board, "board.items", "i1");
    const hosted = ["board.items", "board.cells"].flatMap(projection =>
      Object.keys(objectOf(objectOf(board.projections)[projection])).map(key =>
        entityNode(scene, board, projection, key)
      )
    );

    expect(hosted).toHaveLength(11);
    for (const node of hosted) {
      expect(node.parent).toBe("ui:boardScreen/boardSlot");
      expect(node.rect).toBeDefined();
    }
    expect(i1).toMatchObject({ name: "i1", type: "Sprite", texture: "board.item-wood-3" });
    expect(i1.rect).toEqual({ x: 428.5, y: 880.5, w: 223, h: 223 });
    expect(entityNode(scene, board, "board.items", "i2").texture).toBe("board.item-wood-1");
    expect(elementAt(scene, center(i1.rect), DEVICE)?.id).toBe(i1.id);
  });

  it("breaks the boardScreen / boardBackground Box tie with the projection key", () => {
    const screenId = idOf(board, "hud", "boardScreen");
    const backgroundId = idOf(board, "hud", "boardBackground");
    const scene = sceneOf(board, {
      entities: [...arrayOf(board.entities), projected(900, backgroundId), projected(901, screenId)]
    });

    expect(objectOf(entityOf(board, backgroundId).components).Box).toEqual(
      objectOf(entityOf(board, screenId).components).Box
    );
    expect(nodeOf(scene, "entity:900").parent).toBe("ui:boardScreen/boardBackground");
    expect(nodeOf(scene, "entity:900").rect).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(nodeOf(scene, "entity:901").parent).toBe("ui:boardScreen");
  });

  it("lists unplaced entities with rect undefined: the hud root, Text-only entities", () => {
    const scene = sceneOf(board);
    const hud = entityNode(scene, board, "hud", "hud");
    const coins = entityNode(scene, board, "hud.coins", "coins");
    const count = entityNode(scene, board, "board.badges", "sawmill.count");

    expect(scene.roots).toEqual(["ui:boardScreen", hud.id]);
    expect(hud).toMatchObject({ type: "Container", parent: undefined, rect: undefined });
    expect(coins).toMatchObject({ parent: "ui:boardScreen/hudRow/coinPill", rect: undefined });
    expect(count.rect).toBeUndefined();
    expect(count.entity?.components).toContain("Text");
  });

  it("hits the settings button at the centre of its game.rect", () => {
    const hit = elementAt(sceneOf(board), center(board.rects.settings), DEVICE);

    expect(hit?.id.startsWith("ui:boardScreen/hudRow/settings")).toBe(true);
  });
});

describe("scene on the live settings popup (board/settings/open)", () => {
  it("unwraps the synthetic root: the popup and the board are roots, painted in reverse", () => {
    const scene = sceneOf(settings);
    const root = objectOf(settings.ui);
    const at = (id: string): number => scene.paintOrder.indexOf(id);

    expect(settings.path).toBe("board/settings/open");
    expect(root.key).toBeUndefined();
    expect(root.type).toBe("screen");
    expect(scene.roots).toEqual([
      "ui:settingsScreen",
      "ui:boardScreen",
      `entity:${idOf(settings, "hud", "hud")}`
    ]);
    expect([...scene.nodes.keys()].some(id => id.startsWith("ui:screen#"))).toBe(false);
    expect(nodeOf(scene, "ui:settingsScreen").parent).toBeUndefined();
    expect(at("ui:boardScreen")).toBe(0);
    expect(at("ui:boardScreen/infoBar")).toBeLessThan(at("ui:settingsScreen"));
    expect(new Set(scene.paintOrder).size).toBe(scene.nodes.size);
  });

  it("hits the popup over the board", () => {
    const hit = elementAt(sceneOf(settings), { x: 540, y: 700 }, DEVICE);

    expect(hit?.id.startsWith("ui:settingsScreen/settingsBoard")).toBe(true);
  });
});

describe("calibration on the inert renderer", () => {
  it.each([
    ["home", () => home, "homeScreen"],
    ["board", () => board, "boardScreen"],
    ["settings", () => settings, "settingsScreen"]
  ])("is the identity on %s, and every keyed rect equals game.rect", (_name, live, key) => {
    const capture = live();
    const target = calibrationTarget(capture.ui);
    if (target === undefined) throw new Error("no calibration target");
    const calibration = calibrationFrom(pageRect(capture.rects[target.key] ?? {}), target.drawn);
    const scene = sceneOf(capture, { calibration });

    expect(target.key).toBe(key);
    expect(calibration).toEqual(IDENTITY);
    expect(scene.calibrated).toBe(true);
    for (const [rectKey, rect] of Object.entries(capture.rects)) {
      expectRect(keyedNode(scene, rectKey).rect, rect);
    }
  });
});
