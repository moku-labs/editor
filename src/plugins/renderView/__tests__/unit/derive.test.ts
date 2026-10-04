/* eslint-disable unicorn/no-null -- null is the catalogue's "looked, not found" marker */
import { describe, expect, it } from "vitest";
import { parseTextureManifest } from "../../../panels/shared/scene";
import {
  bundleCounts,
  bundleRowsOf,
  deriveSnapshot,
  firstNodeWithTexture,
  nextSort,
  releasesOf,
  textureRowsOf,
  tilesOf,
  treeCounts,
  treeRowsOf,
  updateTextureUse,
  visibleTextureRows
} from "../../derive";
import { asAssetsUsage, asRenderStats } from "../../guards";
import { createRenderViewState } from "../../state";
import type { AssetsUsage, RenderViewState } from "../../types";
import { ASSETS, boardScene, CONFIG, MANIFEST_TEXT, RENDER } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// derive.ts: the pure derivations of the Render workspace — tiles, texture rows
// and their use, bundles, pools, the release log and the tree rows.
// ─────────────────────────────────────────────────────────────────────────────

function stateWithData(): RenderViewState {
  const state = createRenderViewState({ config: CONFIG });
  state.render = asRenderStats(RENDER);
  state.assets = asAssetsUsage(ASSETS);
  state.catalogue = parseTextureManifest(MANIFEST_TEXT, "manifest.json");
  state.firstFrame = 100;
  state.lastFrame = 1841;
  state.fps = [58, 60, 59];
  return state;
}

function usage(names: readonly string[]): AssetsUsage {
  return {
    textureMb: names.length,
    budgetMb: 192,
    bundles: names.map(name => ({ name, tier: "scene", mb: 1, lastUsed: 1 }))
  };
}

describe("tiles", () => {
  it("are all undefined without data, heap absent until the page reports it", () => {
    const tiles = tilesOf(createRenderViewState({ config: CONFIG }), []);

    expect(tiles).toEqual({
      fps: undefined,
      frameMs: undefined,
      drawCalls: undefined,
      textures: undefined,
      scene: undefined,
      heap: { kind: "absent" }
    });
  });

  it("read the page heap stored with the last game.render change", () => {
    const state = stateWithData();
    state.heap = { usedMb: 12.8, limitMb: 4095.8 };

    expect(tilesOf(state, []).heap).toEqual({ kind: "value", usedMb: 12.8, limitMb: 4095.8 });
    expect(deriveSnapshot(state).tiles.heap).not.toBe(state.heap);
  });

  it("read game.render, game.assets and the scene", () => {
    const state = stateWithData();
    state.scene = boardScene();
    const tiles = tilesOf(state, textureRowsOf(state));

    expect(tiles.fps).toEqual({ now: 60, samples: [58, 60, 59], low: 58 });
    expect(tiles.frameMs).toBe(3.4);
    expect(tiles.drawCalls).toEqual({ kind: "absent" });
    expect(tiles.textures).toEqual({
      gpuMb: 41.25,
      count: 12,
      bundles: 2,
      budgetMb: 192,
      unused: 3,
      unusedMb: 5.73
    });
    expect(tiles.scene).toEqual({ entities: 104, views: 180, pooled: 24 });
  });

  it("show draw calls when game.render reports them", () => {
    const state = stateWithData();
    state.render = asRenderStats({ ...(RENDER as object), drawCalls: 42 });

    expect(tilesOf(state, []).drawCalls).toEqual({ kind: "value", value: 42 });
  });

  it("carry scene.effects and drawCalls.renderPasses when reported (game 0.0.3)", () => {
    const state = stateWithData();
    state.scene = boardScene();
    state.render = asRenderStats({ ...(RENDER as object), renderPasses: 1, drawCalls: 14 });
    state.effects = { particles: 18, emitters: 1, filters: 24, renderPasses: 49 };
    const tiles = tilesOf(state, []);

    expect(tiles.drawCalls).toStrictEqual({ kind: "value", value: 14, renderPasses: 1 });
    expect(tiles.scene).toStrictEqual({
      entities: 104,
      views: 180,
      pooled: 24,
      effects: { particles: 18, emitters: 1, filters: 24, renderPasses: 49 }
    });
    expect(tiles.scene?.effects).not.toBe(state.effects);

    state.render = asRenderStats({ ...(RENDER as object), renderPasses: 2 });
    expect(tilesOf(state, []).drawCalls).toStrictEqual({ kind: "absent", renderPasses: 2 });
  });

  it("omit the effects and renderPasses keys on an older game", () => {
    const state = stateWithData();
    state.scene = boardScene();
    const tiles = tilesOf(state, []);

    expect(tiles.drawCalls).toStrictEqual({ kind: "absent" });
    expect(tiles.drawCalls).not.toHaveProperty("renderPasses");
    expect(tiles.scene).toStrictEqual({ entities: 104, views: 180, pooled: 24 });
    expect(tiles.scene).not.toHaveProperty("effects");
  });

  it("keep fps low at now while no sample was kept", () => {
    const state = stateWithData();
    state.fps = [];

    expect(tilesOf(state, []).fps).toEqual({ now: 60, samples: [], low: 60 });
  });
});

describe("texture rows", () => {
  it("list the textures of the loaded bundles only, GPU MB = w × h × 4", () => {
    const rows = textureRowsOf(stateWithData());

    expect(rows.map(row => row.key).toSorted()).toEqual([
      "board.board-tray",
      "board.cell",
      "ui.hud-pill"
    ]);
    expect(rows.find(row => row.key === "ui.hud-pill")).toMatchObject({
      bundle: "ui",
      width: 1024,
      height: 1024,
      gpuMb: 4,
      fileMb: 0.61
    });
  });

  it("are empty without a catalogue or without game.assets", () => {
    const state = stateWithData();
    state.catalogue = null;
    expect(textureRowsOf(state)).toEqual([]);

    const other = stateWithData();
    other.assets = undefined;
    expect(textureRowsOf(other)).toEqual([]);
  });

  it("follow the use: in-use → unused-since F → in-use again; never seen → not-seen since firstFrame", () => {
    const state = stateWithData();
    updateTextureUse(state, boardScene(200));
    const useOf = (key: string) => textureRowsOf(state).find(row => row.key === key)?.use;

    expect(useOf("board.cell")).toEqual({ kind: "in-use" });
    expect(useOf("ui.hud-pill")).toEqual({ kind: "in-use" });

    // A scene without the hud pill: unused since that frame.
    const without = boardScene(212);
    updateTextureUse(state, {
      ...without,
      referencedTextures: new Set(
        [...without.referencedTextures].filter(key => key !== "ui.hud-pill")
      )
    });
    expect(useOf("ui.hud-pill")).toEqual({ kind: "unused-since", frame: 212 });

    // Still unused later: the frame stays the first one.
    updateTextureUse(state, { ...boardScene(230), referencedTextures: new Set(["board.cell"]) });
    expect(useOf("ui.hud-pill")).toEqual({ kind: "unused-since", frame: 212 });

    updateTextureUse(state, boardScene(240));
    expect(useOf("ui.hud-pill")).toEqual({ kind: "in-use" });

    const fresh = stateWithData();
    expect(textureRowsOf(fresh)[0]?.use).toEqual({ kind: "not-seen", since: 100 });
  });

  it("sets firstFrame from the first scene when no game.render came yet", () => {
    const state = createRenderViewState({ config: CONFIG });
    updateTextureUse(state, boardScene(77));

    expect(state.firstFrame).toBe(77);
    expect(state.seen.get("board.cell")).toEqual({ lastSeen: 77, unusedSince: undefined });
  });

  it("sort by gpuMb descending by default, filter by bundle, count per bundle", () => {
    const state = stateWithData();

    expect(visibleTextureRows(state).map(row => row.key)).toEqual([
      "ui.hud-pill",
      "board.board-tray",
      "board.cell"
    ]);

    state.table.bundle = "board";
    expect(visibleTextureRows(state).map(row => row.key)).toEqual([
      "board.board-tray",
      "board.cell"
    ]);
    expect(bundleCounts(textureRowsOf(state))).toEqual(
      new Map([
        ["board", 2],
        ["ui", 1]
      ])
    );
  });

  it("sort by every column, ties by key", () => {
    const state = stateWithData();
    updateTextureUse(state, { ...boardScene(300), referencedTextures: new Set(["board.cell"]) });
    const keys = (sort: RenderViewState["table"]["sort"], dir: 1 | -1) => {
      state.table.sort = sort;
      state.table.dir = dir;
      return visibleTextureRows(state).map(row => row.key);
    };

    expect(keys("key", 1)).toEqual(["board.board-tray", "board.cell", "ui.hud-pill"]);
    expect(keys("key", -1)).toEqual(["ui.hud-pill", "board.cell", "board.board-tray"]);
    expect(keys("bundle", 1)).toEqual(["board.board-tray", "board.cell", "ui.hud-pill"]);
    expect(keys("size", -1)).toEqual(["ui.hud-pill", "board.board-tray", "board.cell"]);
    expect(keys("fileMb", -1)).toEqual(["board.board-tray", "ui.hud-pill", "board.cell"]);
    expect(keys("use", 1)).toEqual(["board.cell", "board.board-tray", "ui.hud-pill"]);
  });

  it("nextSort flips the same key, sorts a new number key descending and text ascending", () => {
    expect(nextSort({ sort: "gpuMb", dir: -1 }, "gpuMb")).toEqual({ sort: "gpuMb", dir: 1 });
    expect(nextSort({ sort: "gpuMb", dir: -1 }, "key")).toEqual({ sort: "key", dir: 1 });
    expect(nextSort({ sort: "key", dir: 1 }, "fileMb")).toEqual({ sort: "fileMb", dir: -1 });
    expect(nextSort({ sort: "key", dir: 1 }, "use")).toEqual({ sort: "use", dir: 1 });
  });
});

describe("bundles and pools", () => {
  it("bundle rows carry files and file MB from the catalogue, share of the largest", () => {
    expect(bundleRowsOf(stateWithData())).toEqual([
      { name: "board", tier: "scene", mb: 4, files: 2, fileMb: 1.728, share: 1 },
      { name: "ui", tier: "core", mb: 2, files: 2, fileMb: 1.2, share: 0.5 }
    ]);
  });

  it("bundle rows without a catalogue have no file numbers; none without game.assets", () => {
    const state = stateWithData();
    state.catalogue = null;
    expect(bundleRowsOf(state)[0]).toEqual({
      name: "board",
      tier: "scene",
      mb: 4,
      files: undefined,
      fileMb: undefined,
      share: 1
    });

    state.assets = undefined;
    expect(bundleRowsOf(state)).toEqual([]);
  });

  it("a zero-MB bundle list has share 0", () => {
    const state = stateWithData();
    state.assets = {
      textureMb: 0,
      budgetMb: 192,
      bundles: [{ name: "a", tier: "scene", mb: 0, lastUsed: 0 }]
    };
    expect(bundleRowsOf(state)[0]?.share).toBe(0);
  });
});

describe("release log", () => {
  it("records every bundle gone since the previous value at the frame", () => {
    const previous = new Map([
      ["board", { tier: "scene", mb: 4 }],
      ["home", { tier: "scene", mb: 2.5 }]
    ]);

    expect(releasesOf(previous, usage(["board"]), 1841)).toEqual([
      { frame: 1841, bundle: "home", tier: "scene", mb: 2.5 }
    ]);
    expect(releasesOf(previous, usage(["board", "home"]), 1841)).toEqual([]);
  });
});

describe("tree rows", () => {
  it("go depth first through open nodes only", () => {
    const scene = boardScene();

    expect(treeRowsOf(scene, new Set()).map(row => row.id)).toEqual([
      "ui:boardScreen",
      "entity:1048640"
    ]);

    const rows = treeRowsOf(scene, new Set(["ui:boardScreen", "ui:boardScreen/boardSlot"]));
    const slot = rows.find(row => row.id === "ui:boardScreen/boardSlot");
    expect(slot).toEqual({
      id: "ui:boardScreen/boardSlot",
      depth: 1,
      name: "boardSlot",
      type: "stack",
      open: true,
      hasChildren: true,
      texture: "board.board-tray",
      entity: undefined,
      key: "boardSlot"
    });
    expect(rows.find(row => row.id === "entity:3145728")).toMatchObject({
      depth: 2,
      name: "c1_0",
      type: "NineSliceSprite",
      texture: "board.cell",
      entity: 3_145_728
    });
  });

  it("are empty without a scene; the head counts cover every node", () => {
    expect(treeRowsOf(undefined, new Set())).toEqual([]);
    expect(treeCounts(boardScene())).toEqual({ nodes: 104, textures: 24, entities: 33 });
    expect(treeCounts(undefined)).toEqual({ nodes: 0, textures: 0, entities: 0 });
  });

  it("finds the first scene node drawing a texture", () => {
    expect(firstNodeWithTexture(boardScene(), "board.cell")?.id).toBe("entity:3145728");
    expect(firstNodeWithTexture(boardScene(), "nope")).toBeUndefined();
    expect(firstNodeWithTexture(undefined, "board.cell")).toBeUndefined();
  });
});

describe("snapshot", () => {
  it("is a copy: frame, tiles, tree, rows, bundles, pools and releases", () => {
    const state = stateWithData();
    state.scene = boardScene();
    state.tree.open.add("ui:boardScreen");
    state.releases = [{ frame: 9, bundle: "home", tier: "scene", mb: 2.5 }];
    const snapshot = deriveSnapshot(state);

    expect(snapshot.frame).toBe(1841);
    expect(snapshot.tree.length).toBeGreaterThan(2);
    expect(snapshot.textures).toHaveLength(3);
    expect(snapshot.bundles).toHaveLength(2);
    expect(snapshot.pools).toEqual({ views: 180, pooled: 24 });
    expect(snapshot.releases).toEqual(state.releases);
    expect(snapshot.releases).not.toBe(state.releases);
    expect(snapshot.tiles.fps?.samples).not.toBe(state.fps);
  });

  it("has no pools before game.render", () => {
    expect(deriveSnapshot(createRenderViewState({ config: CONFIG })).pools).toBeUndefined();
  });
});
