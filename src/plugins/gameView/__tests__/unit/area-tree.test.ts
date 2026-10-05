import { describe, expect, it } from "vitest";
import type { SceneNode, SceneSnapshot } from "../../../panels/shared/scene";
import {
  areaBranches,
  layoutLines,
  partlyInArea,
  shortText,
  TREE_LINES
} from "../../reference/area-tree";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The fuller area card (captures-by-day U5), pure: the child tree under each
// group root (depth 3, 60 lines, then +N more), the texts, one layout line per
// parent chain, and the nodes partly in the area.
// ─────────────────────────────────────────────────────────────────────────────

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

/** The hud area: the home button and the coin pill. */
const HUD_AREA = { x: 30, y: 45, w: 520, h: 135 };

/** The group roots of the hud area. */
const HUD_ROOTS = [nodeOf("ui:boardScreen/hudRow/home"), nodeOf("ui:boardScreen/hudRow/coinPill")];

/**
 * A text map as the reader of a node's text.
 *
 * @param texts - Text per node id.
 * @returns The reader.
 */
function textsOf(texts: Readonly<Record<string, string>>): (node: SceneNode) => string | undefined {
  return node => texts[node.id];
}

/**
 * A calibrated scene of one root row with `count` keyed 10 px children.
 *
 * @param count - How many children.
 * @returns The scene.
 */
function wideScene(count: number): SceneSnapshot {
  const nodes = new Map<string, SceneNode>();
  const children = Array.from({ length: count }, (_, index) => `ui:wide/k${index}`);
  const base = {
    texture: undefined,
    style: undefined,
    visible: true,
    entity: undefined
  } as const;
  const rootRect = { x: 0, y: 0, w: 2000, h: 10 };
  nodes.set("ui:wide", {
    ...base,
    id: "ui:wide",
    ref: { kind: "ui", path: "wide" },
    name: "wide",
    type: "row",
    parent: undefined,
    children,
    rect: rootRect,
    refRect: rootRect,
    key: "wide"
  });
  for (const [index, id] of children.entries()) {
    const rect = { x: index * 20, y: 0, w: 10, h: 10 };
    nodes.set(id, {
      ...base,
      id,
      ref: { kind: "ui", path: `wide/k${index}` },
      name: `k${index}`,
      type: "text",
      parent: "ui:wide",
      children: [],
      rect,
      refRect: rect,
      key: `k${index}`
    });
  }
  const ids = [...nodes.keys()];
  return {
    frame: 7,
    calibrated: true,
    nodes,
    roots: ["ui:wide"],
    paintOrder: ids,
    referencedTextures: new Set(),
    entityCount: 0
  };
}

describe("shortText", () => {
  it("trims, keeps at most 40 characters and drops an empty text", () => {
    expect(shortText("  1 250 \n")).toBe("1 250");
    expect(shortText("a".repeat(45))).toBe(`${"a".repeat(39)}…`);
    expect(shortText("a".repeat(40))).toBe("a".repeat(40));
    expect(shortText("   ")).toBeUndefined();
    expect(shortText(undefined)).toBeUndefined();
  });
});

describe("areaBranches", () => {
  it("lists the visible descendants of each root in tree order, with their depth and text", () => {
    const texts = textsOf({ "ui:boardScreen/hudRow/coinPill/coinPillText": " 1 250 " });
    const branches = areaBranches(boardScene(), HUD_ROOTS, texts);

    const home = branches.get("ui:boardScreen/hudRow/home");
    expect(home?.children.map(child => [child.node.name, child.depth])).toEqual([["homeIcon", 1]]);
    const coin = branches.get("ui:boardScreen/hudRow/coinPill");
    expect(coin?.children.map(child => [child.node.name, child.text])).toEqual([
      ["coinPillIcon", undefined],
      ["coinPillText", "1 250"]
    ]);
    expect(coin?.more).toBe(0);
  });

  it("goes 3 levels below the root; a node at the last level shows the text under it", () => {
    const texts = textsOf({
      "ui:boardScreen/orders/card0/card0Picture/card0Level/card0LevelNumber": "4"
    });
    const branch = areaBranches(boardScene(), [nodeOf("ui:boardScreen/orders")], texts).get(
      "ui:boardScreen/orders"
    );
    const names = branch?.children.map(child => child.node.name) ?? [];
    expect(names).toContain("card0Level");
    expect(names).not.toContain("card0LevelNumber");
    expect(Math.max(...(branch?.children.map(child => child.depth) ?? []))).toBe(3);
    expect(branch?.children.find(child => child.node.name === "card0Level")?.text).toBe("4");
  });

  it("keeps the text of the root itself", () => {
    const texts = textsOf({ "ui:boardScreen/hudRow/home": "Home" });
    expect(
      areaBranches(boardScene(), HUD_ROOTS, texts).get("ui:boardScreen/hudRow/home")?.text
    ).toBe("Home");
  });

  it("prints at most 60 child lines in the whole tree, then says how many more", () => {
    const scene = wideScene(TREE_LINES + 5);
    const root = scene.nodes.get("ui:wide");
    if (root === undefined) throw new Error("fixture");
    const branch = areaBranches(scene, [root], () => undefined).get("ui:wide");
    expect(branch?.children).toHaveLength(TREE_LINES);
    expect(branch?.more).toBe(5);
  });

  it("leaves hidden nodes out", () => {
    const scene = boardScene();
    const icon = scene.nodes.get("ui:boardScreen/hudRow/home/homeIcon");
    if (icon === undefined) throw new Error("fixture");
    const nodes = new Map(scene.nodes);
    nodes.set(icon.id, { ...icon, visible: false });
    const branch = areaBranches({ ...scene, nodes }, HUD_ROOTS, () => undefined);
    expect(branch.get("ui:boardScreen/hudRow/home")?.children).toEqual([]);
  });
});

describe("layoutLines", () => {
  it("is one line per parent chain: the roots, then up to 3 parents with their layout", () => {
    const roots = [...HUD_ROOTS, nodeOf("ui:boardScreen/orders/card0")];
    expect(layoutLines(boardScene(), roots)).toEqual([
      "home, coinPill < hudRow (row, padding 0/40/0/40, margin 40/0/0/0) < boardScreen (column, padding 0/0/0/0)",
      expect.stringMatching(
        /^card0 < orders \(row.*\) < boardScreen \(column, padding 0\/0\/0\/0\)$/
      )
    ]);
  });

  it("has no line for a root without parents", () => {
    expect(layoutLines(boardScene(), [nodeOf("ui:boardScreen")])).toEqual([]);
  });
});

describe("partlyInArea", () => {
  it("lists the nodes that overlap but are not inside: no parent in a layout line, no group node", () => {
    const partly = partlyInArea(boardScene(), HUD_AREA, HUD_ROOTS);
    expect(partly.map(node => node.name)).toEqual(["boardBackground"]);
  });

  it("orders by the overlap, largest first", () => {
    const area = { x: 30, y: 45, w: 520, h: 200 };
    const names = partlyInArea(boardScene(), area, HUD_ROOTS).map(node => node.name);
    expect(names[0]).toBe("boardBackground");
    expect(names).toContain("orders");
    expect(names).not.toContain("hudRow");
  });

  it("keeps at most 8, and none in a scene without a calibration", () => {
    const scene = wideScene(20);
    const area = { x: 5, y: 5, w: 400, h: 10 };
    expect(partlyInArea(scene, area, [])).toHaveLength(8);
    expect(partlyInArea({ ...boardScene(), calibrated: false }, HUD_AREA, HUD_ROOTS)).toEqual([]);
  });
});
