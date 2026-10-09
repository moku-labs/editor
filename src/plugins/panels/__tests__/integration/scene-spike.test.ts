import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ITEM_SIZE,
  startTinyScreenGame,
  type TinyScreenGame
} from "../../../../../tests/fixtures/tiny-screen-game";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import type { Json } from "../../../registry/protocol";
import type { RegistryApi } from "../../../registry/types";
import type { PageRect, SceneInput, SceneNode, SceneSnapshot } from "../../shared/scene";
import {
  buildScene,
  calibrationFrom,
  calibrationTarget,
  elementAt,
  rectSourceOf
} from "../../shared/scene";

// ─────────────────────────────────────────────────────────────────────────────
// Build spike of scene/ (R8) on a live game: the tiny screen game with the
// inert renderer and headless assets (no io: every bundle counts as loaded).
// The agent registry reads game.ui, game.entities, game.projections and the
// rect source game.locate at home, at board/awaitIntent and at
// board/settings/open, and the scene rules 2–4 run on those values.
// ─────────────────────────────────────────────────────────────────────────────

/** A JSON object. */
type JsonObject = { [key: string]: Json };

/** One capture of the three scene sources plus the page rects of some keys. */
type Capture = {
  readonly path: string;
  readonly ui: Json;
  readonly entities: Json;
  readonly projections: Json;
  readonly rects: Readonly<Record<string, PageRect>>;
};

const IDENTITY = { scale: 1, x: 0, y: 0 };

/** The entities on the board: the hud root, its seven ui elements, two items and the badge. */
const ENTITY_COUNT = 11;

const agentCore = createAgentCore(agentCoreConfig, { plugins: [registryPlugin] });

let game: TinyScreenGame;
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

/**
 * Taps a keyed element and steps frames until the flow reaches a path, then `settle` more.
 *
 * @param key - The element key.
 * @param target - The flow path to reach.
 * @param settle - Frames to step after it.
 */
async function tapUntil(key: string, target: string, settle: number): Promise<void> {
  const tapped = registry.command("game.tap")?.run({ key });
  await game.until(target);
  await game.frames(settle);
  await tapped;
}

function read(id: string, input: Json = {}): Json {
  const source = registry.source(id);
  if (source === undefined) throw new Error(`no source ${id}`);
  return source.read(input);
}

/**
 * The rect source the manifest lists: game.locate (game 0.4) or game.rect (game 0.1).
 *
 * @returns The source id.
 */
function rectSource(): string {
  const id = rectSourceOf(registry.manifest());
  if (id === undefined) throw new Error("no rect source");
  return id;
}

/** Reads the scene sources, and the page rects of some keys and of the calibration target. */
function captureLive(keys: readonly string[]): Capture {
  const ui = read("game.ui");
  const source = rectSource();
  const target = calibrationTarget(ui)?.key;
  const rects: Record<string, PageRect> = {};
  for (const key of target === undefined ? keys : [...keys, target]) {
    rects[key] = pageRect(read(source, { key }));
  }
  return {
    path: game.app.flow.state().path,
    ui,
    entities: read("game.entities"),
    projections: read("game.projections"),
    rects
  };
}

beforeAll(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startTinyScreenGame();

  const agent = agentCore.createApp({ pluginConfigs: { registry: { game: game.app } } });
  await agent.start();
  registry = agent.registry;

  home = captureLive(["play"]);
  await tapUntil("play", "board/awaitIntent", 6);
  board = captureLive(["settings", "boardScreen", "tray", "coinPill"]);
  await tapUntil("settings", "board/settings/open", 6);
  settings = captureLive(["settingsScreen", "settingsBoard", "close"]);
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

// ─────────────────────────────────────────────────────────────────────────────

describe("scene on the live board (board/awaitIntent)", () => {
  it("names ui nodes by their key paths", () => {
    const scene = sceneOf(board);

    expect(board.path).toBe("board/awaitIntent");
    expect(scene.calibrated).toBe(false);
    expect(scene.entityCount).toBe(ENTITY_COUNT);
    expect(keyedNode(scene, "tray").id).toBe("ui:boardScreen/tray");
    expect(keyedNode(scene, "settings").id).toBe("ui:boardScreen/hudRow/settings");
    expect(nodeOf(scene, "ui:boardScreen/hudRow/coinPill")).toMatchObject({
      ref: { kind: "ui", path: "boardScreen/hudRow/coinPill" },
      type: "panel",
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

  it("hosts the items under the tray, with rects", () => {
    const scene = sceneOf(board);
    const a = entityNode(scene, board, "tiny.items", "a");
    const hosted = Object.keys(objectOf(objectOf(board.projections)["tiny.items"])).map(key =>
      entityNode(scene, board, "tiny.items", key)
    );
    const tray = board.rects.tray;
    if (tray === undefined) throw new Error("no tray rect");
    // A sprite is centred on its Transform: (100 + slot * 200, 100) in the tray's own space.
    const itemRect = (slot: number): PageRect => ({
      x: tray.x + 100 + slot * 200 - ITEM_SIZE / 2,
      y: tray.y + 100 - ITEM_SIZE / 2,
      w: ITEM_SIZE,
      h: ITEM_SIZE
    });

    expect(hosted).toHaveLength(2);
    for (const node of hosted) expect(node.parent).toBe("ui:boardScreen/tray");
    expect(Object.fromEntries(hosted.map(node => [node.name, node.rect]))).toEqual({
      a: itemRect(0),
      b: itemRect(1)
    });
    expect(a).toMatchObject({ name: "a", type: "Sprite", texture: "board.cell" });
    expect(elementAt(scene, center(a.rect))?.id).toBe(a.id);
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
    const count = entityNode(scene, board, "tiny.badges", "count");

    expect(scene.roots).toEqual(["ui:boardScreen", hud.id]);
    expect(hud).toMatchObject({ type: "Container", parent: undefined, rect: undefined });
    expect(count.rect).toBeUndefined();
    expect(count.entity?.components).toContain("Text");
  });

  it("hits the settings button at the centre of its page rect", () => {
    const hit = elementAt(sceneOf(board), center(board.rects.settings));

    expect(hit?.id.startsWith("ui:boardScreen/hudRow/settings")).toBe(true);
  });
});

describe("scene on the live settings popup (board/settings/open)", () => {
  it("unwraps the synthetic root: the popup and the board are roots, the popup painted last", () => {
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
    expect(at("ui:boardScreen/tray")).toBeLessThan(at("ui:settingsScreen"));
    expect(new Set(scene.paintOrder).size).toBe(scene.nodes.size);
  });

  it("hits the popup over the board", () => {
    const hit = elementAt(sceneOf(settings), { x: 540, y: 700 });

    expect(hit?.id.startsWith("ui:settingsScreen/settingsBoard")).toBe(true);
  });

  it("blocks the board under the backdrop: the settings icon's spot gives the backdrop", () => {
    const hit = elementAt(sceneOf(settings), center(board.rects.settings));

    expect(hit?.id).toBe("ui:settingsScreen/settingsBackdrop");
    expect(hit?.id.startsWith("ui:boardScreen")).toBe(false);
  });
});

describe("calibration on the inert renderer", () => {
  it.each([
    ["home", () => home, "homeScreen"],
    ["board", () => board, "boardScreen"],
    ["settings", () => settings, "settingsScreen"]
  ])("is the identity on %s, and every keyed rect equals the rect source", (_name, live, key) => {
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
