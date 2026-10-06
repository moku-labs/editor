import { describe, expect, it } from "vitest";
import type { SceneNode } from "../../../panels/shared/scene";
import { isSelectionInfo } from "../../../registry/protocol";
import {
  areaSelection,
  bareSelection,
  elementByKey,
  itemOf,
  projectionOf,
  selectionOf,
  sourceAt
} from "../../element/selection";
import { sceneCapture } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The selection as the editor page publishes it (U4, A10, U9): the
// SelectionInfo of a scene node, of a node not in the scene, of an area and
// its items; the projection a node belongs to; the element a key names, plain
// or projection-qualified ("hud/infoBar").
// ─────────────────────────────────────────────────────────────────────────────

const BOARD = sceneCapture("scene-board.txt");

/** The facts every info here is built with. */
const FACTS = { session: "s-1", frame: 1841, at: 1_790_000_000_000 };

/**
 * A node of the board scene.
 *
 * @param id - Its node id.
 * @returns The node.
 */
function nodeOf(id: string): SceneNode {
  const node = boardScene().nodes.get(id);
  if (node === undefined) throw new Error(`fixture: ${id}`);
  return node;
}

describe("selectionOf", () => {
  it("names a ui node: ref, key, projection, name, type, rect, session, frame, at", () => {
    const info = selectionOf(nodeOf("ui:boardScreen/infoBar"), {
      ...FACTS,
      projections: BOARD.projections,
      source: undefined
    });
    expect(info).toEqual({
      ref: { kind: "ui", path: "boardScreen/infoBar" },
      key: "infoBar",
      projection: "hud",
      name: "infoBar",
      type: "row",
      rect: { x: 125, y: 1837, w: 830, h: 160 },
      session: "s-1",
      frame: 1841,
      at: 1_790_000_000_000
    });
    expect(isSelectionInfo(info)).toBe(true);
  });

  it("adds the source line once the index answered it", () => {
    const info = selectionOf(nodeOf("ui:boardScreen/hudRow/coinPill"), {
      ...FACTS,
      projections: BOARD.projections,
      source: { kind: "defined", path: "src/hud/Hud.tsx", line: 12, range: [11, 5, 14, 9] }
    });
    expect(info.source).toEqual({ path: "src/hud/Hud.tsx", line: 12 });
  });

  it("names an entity by its projection key, its owner is the projection; no key", () => {
    const info = selectionOf(nodeOf("entity:1048628"), {
      ...FACTS,
      projections: BOARD.projections,
      source: undefined
    });
    expect(info).toMatchObject({
      ref: { kind: "entity", id: 1_048_628 },
      projection: "board.items",
      name: "i1",
      type: "Sprite"
    });
    expect(info.key).toBeUndefined();
  });

  it("leaves out what is not known: no key, no rect, no session, no projection", () => {
    const unplaced: SceneNode = { ...nodeOf("ui:boardScreen/hudRow/home"), key: undefined };
    const info = selectionOf(
      { ...unplaced, rect: undefined },
      {
        session: undefined,
        frame: 3,
        at: 1,
        projections: undefined,
        source: undefined
      }
    );
    expect(Object.keys(info).toSorted()).toEqual(["at", "frame", "name", "ref", "type"]);
  });
});

describe("bareSelection", () => {
  it("names a ref the scene does not have by its last path segment or its entity id", () => {
    expect(bareSelection({ kind: "ui", path: "settingsScreen/close" }, FACTS)).toEqual({
      ref: { kind: "ui", path: "settingsScreen/close" },
      name: "close",
      type: "ui",
      ...FACTS
    });
    expect(bareSelection({ kind: "entity", id: 7 }, { ...FACTS, session: undefined })).toEqual({
      ref: { kind: "entity", id: 7 },
      name: "#7",
      type: "entity",
      frame: 1841,
      at: 1_790_000_000_000
    });
  });
});

describe("projectionOf", () => {
  it("is the entity's owner, or the projection whose keys hold the ui key", () => {
    const { projections } = BOARD;
    expect(projectionOf(projections, nodeOf("entity:1048630"))).toBe("board.generators");
    expect(projectionOf(projections, nodeOf("ui:boardScreen/hudRow/coinPill"))).toBe("hud");
    expect(projectionOf(undefined, nodeOf("ui:boardScreen/hudRow/coinPill"))).toBeUndefined();
  });

  it("prefers the projection that also holds the node's root key when two hold its key", () => {
    const projections = {
      shop: { close: 1, shopScreen: 2 },
      settings: { close: 3, settingsScreen: 4 }
    };
    const node: SceneNode = { ...nodeOf("ui:boardScreen/hudRow/home"), key: "close" };
    const settingsClose: SceneNode = {
      ...node,
      id: "ui:settingsScreen/close",
      ref: { kind: "ui", path: "settingsScreen/close" }
    };
    expect(projectionOf(projections, settingsClose)).toBe("settings");
    expect(projectionOf(projections, { ...settingsClose, key: "back" })).toBe("settings");
    expect(projectionOf(projections, { ...node, ref: { kind: "ui", path: "x/close" } })).toBe(
      "shop"
    );
  });
});

describe("elementByKey", () => {
  it("finds the first ui node with the key", () => {
    expect(elementByKey(boardScene(), BOARD.projections, "infoBar")?.id).toBe(
      "ui:boardScreen/infoBar"
    );
    expect(elementByKey(boardScene(), BOARD.projections, "nowhere")).toBeUndefined();
  });

  it("takes a projection-qualified key: <projection>/<key>", () => {
    expect(elementByKey(boardScene(), BOARD.projections, "hud/infoBar")?.id).toBe(
      "ui:boardScreen/infoBar"
    );
    expect(elementByKey(boardScene(), BOARD.projections, "board.items/infoBar")).toBeUndefined();
    expect(elementByKey(boardScene(), BOARD.projections, "/infoBar")).toBeUndefined();
  });

  it("never answers an entity: a key names a ui node", () => {
    expect(elementByKey(boardScene(), BOARD.projections, "board.items/i1")).toBeUndefined();
  });
});

describe("itemOf and areaSelection (U9)", () => {
  it("an item is the element part of an info: ref, key, name, type, rect, source", () => {
    const item = itemOf(nodeOf("ui:boardScreen/hudRow/home"), {
      kind: "call",
      path: "src/hud.tsx",
      line: 4,
      range: [4, 3, 6, 5],
      call: "pill(1)",
      callLine: 5
    });
    expect(item).toEqual({
      ref: { kind: "ui", path: "boardScreen/hudRow/home" },
      key: "home",
      name: "home",
      type: "button",
      rect: { x: 40, y: 52, w: 120, h: 120 },
      source: { path: "src/hud.tsx", line: 4 }
    });
  });

  it("an area is named area, typed area, its rect is the area, its ref the first item's", () => {
    const area = { x: 30, y: 45, w: 520, h: 135 };
    const items = [
      itemOf(nodeOf("ui:boardScreen/hudRow/home"), undefined),
      itemOf(nodeOf("ui:boardScreen/hudRow/coinPill"), undefined)
    ];
    const info = areaSelection(area, items, FACTS);
    expect(info).toEqual({
      ref: { kind: "ui", path: "boardScreen/hudRow/home" },
      name: "area",
      type: "area",
      rect: area,
      area,
      items,
      ...FACTS
    });
    expect(isSelectionInfo(info)).toBe(true);
  });

  it("an empty area has the empty ui ref", () => {
    const info = areaSelection({ x: 0, y: 0, w: 10, h: 10 }, [], FACTS);
    expect(info.ref).toEqual({ kind: "ui", path: "" });
    expect(info.items).toEqual([]);
  });

  it("sourceAt keeps the file and the key line of any source", () => {
    const text = {
      kind: "defined",
      path: "a.tsx",
      line: 3,
      range: [3, 1, 3, 40],
      textStyle: "ui.link"
    } as const;
    expect(sourceAt(text)).toEqual({
      path: "a.tsx",
      line: 3
    });
  });
});
