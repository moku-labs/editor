// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageRect, SceneNode, SceneSnapshot } from "../../../panels/shared/scene";
import type { SelectionInfo } from "../../../registry/protocol";
import { AREA_ITEMS, areaGroup, pickArea, pickDraggedArea } from "../../reference/area";
import { CROP_JPEG, stubCanvas } from "../canvas";
import { createCtx, flush, JPEG, manifestOf, type TestCtx, useScene } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Reference mode area pick (U9): the group of an area (visible placed nodes
// fully inside, else the ones it covers by half; group roots only; top to
// bottom, then left to right; at most 40), then the pick path with the area:
// bookmark, full shot, crop, the card area-f<frame>.md, the area line on the
// clipboard, the capture card, and the selection published twice (A18).
// ─────────────────────────────────────────────────────────────────────────────

/** The left of the hud row: the home button and the coin pill. */
const HUD_AREA: PageRect = { x: 30, y: 45, w: 520, h: 135 };

/** The source of the coin pill and the home button. */
const HUD = {
  "src/hud/Hud.tsx": '<Button key="home" />\n<Pill key="coinPill" style={coinPill} />\n'
};

let ctx: TestCtx;
let writeText: ReturnType<typeof vi.fn>;

/**
 * The keys of a group, in order.
 *
 * @param scene - The scene.
 * @param area - The area.
 * @returns The keys (the name for an unkeyed node).
 */
function keysIn(scene: SceneSnapshot, area: PageRect): string[] {
  return areaGroup(scene, area).nodes.map(node => node.key ?? node.name);
}

/**
 * A calibrated scene of `count` keyed 10 px boxes, ten per row, 20 px apart.
 *
 * @param count - How many boxes.
 * @returns The scene.
 */
function gridScene(count: number): SceneSnapshot {
  const nodes = new Map<string, SceneNode>();
  for (let index = 0; index < count; index += 1) {
    const key = `k${index}`;
    const rect = { x: (index % 10) * 20, y: Math.floor(index / 10) * 20, w: 10, h: 10 };
    nodes.set(`ui:grid/${key}`, {
      id: `ui:grid/${key}`,
      ref: { kind: "ui", path: `grid/${key}` },
      name: key,
      type: "text",
      parent: undefined,
      children: [],
      rect,
      refRect: rect,
      texture: undefined,
      key,
      style: undefined,
      visible: true,
      entity: undefined
    });
  }
  const ids = [...nodes.keys()];
  return {
    frame: 7,
    calibrated: true,
    nodes,
    roots: ids,
    paintOrder: ids,
    referencedTextures: new Set(),
    entityCount: 0
  };
}

/**
 * Every value gameView published.
 *
 * @returns The params of each `notify("selection", …)`.
 */
function published(): (SelectionInfo | null)[] {
  return ctx.link.notify.mock.calls.map(([, params]) => params);
}

beforeEach(() => {
  ctx = createCtx(HUD);
  useScene(ctx);
  ctx.state.scene = boardScene();
  ctx.state.calibration = { scale: 1, x: 0, y: 0 };
  ctx.state.sources = { projections: { hud: { home: 1, coinPill: 2 } } };
  ctx.link.manifestValue = manifestOf([
    ["game.bookmark", "read"],
    ["editor.capture", "read"]
  ]);
  ctx.panels.answers.set("game.bookmark", { path: "board/awaitIntent" });
  ctx.panels.answers.set("editor.capture", {
    image: JPEG,
    frame: 1842,
    device: { w: 393, h: 852, orientation: "portrait" }
  });
  writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  stubCanvas({ width: 1179, height: 2556 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("areaGroup", () => {
  it("takes the nodes fully inside, group roots only: a child of a member is dropped", () => {
    expect(keysIn(boardScene(), HUD_AREA)).toEqual(["home", "coinPill"]);
  });

  it("orders top to bottom, then left to right", () => {
    expect(keysIn(boardScene(), { x: 40, y: 220, w: 1000, h: 625 })).toEqual([
      "card0",
      "card2",
      "card1"
    ]);
  });

  it("with none fully inside takes the nodes the area covers by half of their own area", () => {
    // coinPill is covered by 54 %, its text by 83 % (dropped: its parent is in), its icon by 34 %.
    expect(keysIn(boardScene(), { x: 240, y: 80, w: 200, h: 60 })).toEqual(["coinPill"]);
  });

  it("skips invisible nodes: the glow over a cell is not in the group", () => {
    const ids = areaGroup(boardScene(), { x: 100, y: 850, w: 290, h: 290 }).nodes.map(
      node => node.id
    );
    expect(ids).toEqual([
      "entity:2097153",
      "entity:1048630",
      "entity:1048632",
      "entity:1048633",
      "entity:1048634",
      "entity:1048635"
    ]);
  });

  it("keeps at most 40 and counts them all", () => {
    expect(AREA_ITEMS).toBe(40);
    const group = areaGroup(gridScene(45), { x: 0, y: 0, w: 400, h: 400 });
    expect(group.total).toBe(45);
    expect(group.nodes).toHaveLength(40);
    expect(group.nodes[10]?.key).toBe("k10");
  });

  it("is empty for an uncalibrated scene: its rects are not device px", () => {
    expect(areaGroup({ ...boardScene(), calibrated: false }, HUD_AREA)).toEqual({
      nodes: [],
      total: 0
    });
  });
});

describe("pickArea", () => {
  it("bookmarks, saves the crop and the full frame, writes the card and copies the area line", async () => {
    const info = await pickArea(ctx, boardScene(), HUD_AREA);

    const line = String(writeText.mock.calls[0]?.at(0));
    expect(line).toBe(
      "@moku area 520×135 · board/awaitIntent · 2 elements · ref 30,45 520×135 · .moku/captures/area-f1842.md"
    );
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Reference, shot and bookmark copied");
    expect(ctx.link.files.dataUrl(".moku/captures/area-f1842-crop.jpg")).toBe(CROP_JPEG);
    expect(ctx.link.files.dataUrl(".moku/captures/f1842-full.jpg")).toBe(JPEG);
    expect(ctx.state.bookmarks[0]?.id).toBe("area-f1841");

    const card = ctx.link.files.text(".moku/captures/area-f1842.md");
    expect(card.split("\n").slice(0, 6)).toEqual([
      "# @moku area 520×135",
      "",
      "```text",
      line,
      "- home button · key home · src/hud/Hud.tsx:1 · ref 40,52 120×120",
      "- coinPill row · key coinPill · src/hud/Hud.tsx:2 · ref 235,74 290×76"
    ]);
    expect(card).toContain("restore: bookmark area-f1841");
    expect(card).toContain(
      "shot: .moku/captures/area-f1842-crop.jpg · frame: .moku/captures/f1842-full.jpg"
    );
    expect(card).toContain("## home · JSX · src/hud/Hud.tsx:1");
    expect(card).toContain("## coinPill · JSX · src/hud/Hud.tsx:2");
    expect(card).toContain("![area](area-f1842-crop.jpg)\n![frame](f1842-full.jpg)\n");

    expect(ctx.state.card).toMatchObject({
      path: ".moku/captures/area-f1842-crop.jpg",
      image: CROP_JPEG,
      reference: line
    });
    expect(info).toMatchObject({
      ref: { kind: "ui", path: "boardScreen/hudRow/home" },
      name: "area",
      type: "area",
      rect: HUD_AREA,
      area: HUD_AREA,
      card: ".moku/captures/area-f1842.md",
      crop: ".moku/captures/area-f1842-crop.jpg",
      line,
      frame: 1842
    });
    expect(info.items?.map(item => item.source)).toEqual([
      { path: "src/hud/Hud.tsx", line: 1 },
      { path: "src/hud/Hud.tsx", line: 2 }
    ]);
  });

  it("publishes the area first without sources, then with them and the card (A18)", async () => {
    ctx.state.selected = { kind: "entity", id: 1_048_628 };
    const info = await pickArea(ctx, boardScene(), HUD_AREA);
    expect(published()).toHaveLength(2);
    expect(published()[0]?.items?.map(item => item.source)).toEqual([undefined, undefined]);
    expect(published()[0]?.card).toBeUndefined();
    expect(published()[1]).toEqual(info);
    expect(ctx.state.selected).toBeUndefined();
    expect(ctx.state.selection).toEqual(info);
  });

  it("an empty area still writes its card and shot: no elements", async () => {
    // Between the coin pill and the order cards: nothing inside, nothing half covered.
    const info = await pickArea(ctx, boardScene(), { x: 360, y: 155, w: 20, h: 20 });
    expect(info.ref).toEqual({ kind: "ui", path: "" });
    expect(info.items).toEqual([]);
    expect(String(writeText.mock.calls[0]?.at(0))).toContain(" · no elements · ");
    expect(ctx.link.files.paths()).toContain(".moku/captures/area-f1842-crop.jpg");
  });

  it("searches at most 10 new sources per area", async () => {
    const list = vi.spyOn(ctx.link.files, "list");
    await pickArea(ctx, gridScene(45), { x: 0, y: 0, w: 400, h: 400 });
    expect(list.mock.calls.filter(([dir]) => dir === "")).toHaveLength(10);
    expect(String(writeText.mock.calls[0]?.at(0))).toContain(" · 45 elements · ");
    expect(ctx.link.files.text(".moku/captures/area-f1842.md")).toContain("\n+5 more\n");
  });

  it("copy false (MCP): no clipboard and no toast; the capture card still shows", async () => {
    await pickArea(ctx, boardScene(), HUD_AREA, { copy: false, card: true });
    expect(writeText).not.toHaveBeenCalled();
    expect(ctx.workspace.toast).not.toHaveBeenCalled();
    expect(ctx.state.card?.path).toBe(".moku/captures/area-f1842-crop.jpg");
  });

  it("card false: no bookmark, no shot, no card; the sources follow in a second publish", async () => {
    const info = await pickArea(ctx, boardScene(), HUD_AREA, { copy: false, card: false });
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(info.card).toBeUndefined();
    await flush();
    expect(published()).toHaveLength(2);
    expect(published()[1]?.items?.[1]?.source).toEqual({ path: "src/hud/Hud.tsx", line: 2 });
  });

  it("a newer selection keeps its publish: the area's late sources are dropped", async () => {
    await pickArea(ctx, boardScene(), HUD_AREA, { copy: false, card: false });
    ctx.state.selection = undefined;
    await flush();
    expect(published()).toHaveLength(1);
  });

  it("without a calibration in state the head has no ref; a card that cannot be written leaves its path out", async () => {
    ctx.state.calibration = undefined;
    ctx.link.files.failWrites(
      ".moku/captures/area-f1842.md",
      Object.assign(new Error("[moku-editor] disk full"), { code: -32_000 })
    );
    const info = await pickArea(ctx, boardScene(), HUD_AREA);
    expect(info.line).toBe("@moku area 520×135 · board/awaitIntent · 2 elements");
    expect(info.card).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: area card failed", {
      message: "[moku-editor] disk full"
    });
  });
});

describe("pickDraggedArea", () => {
  it("reads a fresh scene, then picks the area", async () => {
    await pickDraggedArea(ctx, HUD_AREA);
    expect(ctx.link.read).toHaveBeenCalledWith("game.ui");
    expect(ctx.link.files.paths()).toContain(".moku/captures/area-f1842.md");
  });

  it("picks from the scene there is when the read fails; nothing without any scene", async () => {
    ctx.link.values.delete("game.ui");
    await pickDraggedArea(ctx, HUD_AREA);
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: area read failed", {
      message: "no value for game.ui"
    });
    expect(ctx.link.files.paths()).toContain(".moku/captures/area-f1842.md");

    ctx.state.scene = undefined;
    ctx.panels.run.mockClear();
    await pickDraggedArea(ctx, HUD_AREA);
    expect(ctx.panels.run).not.toHaveBeenCalled();
  });
});
