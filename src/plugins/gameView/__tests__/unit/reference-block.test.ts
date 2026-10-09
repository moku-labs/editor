import { describe, expect, it } from "vitest";
import { buildScene, type SceneNode, type SceneSnapshot } from "../../../panels/shared/scene";
import {
  flowNodeOf,
  type ReferenceFacts,
  rectText,
  referenceBlock,
  sourceText
} from "../../reference/block";
import type { StyleSource } from "../../types";
import { sceneCapture } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The reference block (round 2 R2): one fact per line in a fixed order, a line
// or a field that is not known left out. Pure: the facts come in, the text
// goes out. Fixtures: the merge-game board and settings captures of panels.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The settings popup scene of merge-game, calibrated at half scale (device px = ref px / 2).
 *
 * @returns The snapshot.
 */
function settingsScene(): SceneSnapshot {
  const capture = sceneCapture("scene-settings.txt");
  const scene = buildScene({ ...capture, frame: 1841, calibration: { scale: 0.5, x: 0, y: 0 } });
  if ("error" in scene) throw new Error("fixture");
  return scene;
}

/**
 * One node of a scene.
 *
 * @param scene - The scene.
 * @param id - Its id.
 * @returns The node.
 */
function nodeOf(scene: SceneSnapshot, id: string): SceneNode {
  const node = scene.nodes.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

/**
 * The ui ancestors of a node, nearest first.
 *
 * @param scene - The scene.
 * @param node - The node.
 * @returns The parents.
 */
function parentsOf(scene: SceneSnapshot, node: SceneNode): SceneNode[] {
  const parents: SceneNode[] = [];
  let parent = node.parent === undefined ? undefined : scene.nodes.get(node.parent);
  while (parent !== undefined) {
    parents.push(parent);
    parent = parent.parent === undefined ? undefined : scene.nodes.get(parent.parent);
  }
  return parents;
}

const SETTINGS = settingsScene();
const PANE = nodeOf(SETTINGS, "ui:settingsScreen/settingsBoard/settingsPane");
const BOARD = nodeOf(SETTINGS, "ui:settingsScreen/settingsBoard");

/** Every fact the block can print, for the settings pane after a pick. */
const FULL: ReferenceFacts = {
  node: PANE,
  parents: parentsOf(SETTINGS, PANE),
  position: { path: "board/settingsPopup/open", flow: "settingsPopup", node: "open" },
  last: { path: "board/awaitIntent", outcome: "openSettings", frame: 1830 },
  source: {
    kind: "ident",
    path: "features/settings/settings.tsx",
    line: 309,
    range: [309, 9, 312, 21],
    ref: { kind: "const", name: "settingsPane" },
    files: ["features/settings/settings.tsx"]
  },
  block: { path: "features/settings/styles.ts", line: 12 },
  flags: ["selected"],
  value: "Settings",
  frame: 1841,
  game: {
    name: "merge-game 0.0.0",
    session: "s-1",
    at: new Date(2026, 9, 4, 9, 5, 7),
    status: "paused",
    tainted: false
  },
  device: {
    name: "iPhone 15",
    w: 393,
    h: 852,
    orientation: "portrait",
    dpr: 3,
    safe: { top: 59, right: 0, bottom: 34, left: 0 }
  },
  pick: {
    bookmark: "settingsPane-f1841",
    crop: ".moku/captures/settingsPane-f1841.png",
    full: ".moku/captures/f1841.png"
  }
};

/** The facts of a node that nothing else is known about. */
function bare(node: SceneNode): ReferenceFacts {
  return {
    node,
    parents: [],
    position: {},
    last: undefined,
    source: undefined,
    block: undefined,
    flags: [],
    value: undefined,
    frame: 12,
    game: {
      name: undefined,
      session: undefined,
      at: undefined,
      status: undefined,
      tainted: undefined
    },
    device: undefined,
    pick: undefined
  };
}

describe("referenceBlock", () => {
  it("prints every line in the fixed order when every fact is known", () => {
    expect(referenceBlock(FULL).split("\n")).toEqual([
      "@moku settingsPane · column · settingsPopup/open · f1841",
      "path: settingsScreen/settingsBoard/settingsPane",
      "source: features/settings/settings.tsx:309 · style: settingsPane features/settings/styles.ts:12 · texture: ui.panel-parchment",
      "layout: settingsBoard (column, padding 266/72/64/72, gap 24) < settingsScreen (column, padding 0/0/0/0)",
      `bounds: ${boundsOf(PANE)}`,
      'state: visible, selected · value "Settings"',
      "flow: board > settingsPopup > open · last: board/awaitIntent → openSettings (f1830)",
      "game: merge-game 0.0.0 · s-1 · f1841 · 09:05:07 · paused · clean",
      "device: iPhone 15 393×852 portrait · dpr 3 · safe 59/0/34/0",
      "restore: bookmark settingsPane-f1841",
      "shot: .moku/captures/settingsPane-f1841.png · frame: .moku/captures/f1841.png"
    ]);
  });

  it("leaves out every line and field that is not known", () => {
    const hud = nodeOf(boardScene(), "entity:1048640");
    expect(referenceBlock(bare(hud))).toBe(
      [
        "@moku hud · Container · f12",
        `path: entity #1048640 (${componentsOf(hud)})`,
        "state: visible"
      ].join("\n")
    );
  });

  it("names at most five components of an entity", () => {
    const item = nodeOf(boardScene(), "entity:1048628");
    expect(item.entity?.components.length).toBeGreaterThan(5);
    const path = referenceBlock(bare(item)).split("\n")[1];
    expect(path).toBe(`path: entity #1048628 (${item.entity?.components.slice(0, 5).join(", ")})`);
  });

  it("prints the bounds in device px and the ref bounds in reference units", () => {
    // Calibrated at half scale: the device rect is half the reference rect.
    expect(PANE.refRect?.w).toBe((PANE.rect?.w ?? 0) * 2);
    expect(referenceBlock(FULL).split("\n")[4]).toBe(`bounds: ${boundsOf(PANE)}`);
  });

  it("keeps the head on the path when the flow or the node is not known", () => {
    const facts = { ...bare(BOARD), position: { path: "settingsPopup/open" } };
    expect(referenceBlock(facts).split("\n")[0]).toBe(
      "@moku settingsBoard · panel · settingsPopup/open · f12"
    );
  });

  it("marks hidden, the true flags, the alpha of the style and a live, tainted game", () => {
    const hidden: SceneNode = { ...BOARD, visible: false, style: { ...BOARD.style, alpha: 0 } };
    const facts: ReferenceFacts = {
      ...bare(hidden),
      flags: ["pressed", "disabled"],
      game: { ...FULL.game, status: "live", tainted: true }
    };
    const lines = referenceBlock(facts).split("\n");
    expect(lines).toContain("state: hidden, pressed, disabled · alpha 0");
    expect(lines).toContain("game: merge-game 0.0.0 · s-1 · f12 · 09:05:07 · live · tainted");
  });

  it("prints the style call of an id prop's component with the file of the call", () => {
    const facts: ReferenceFacts = {
      ...bare(BOARD),
      source: {
        kind: "call",
        path: "settings.tsx",
        line: 290,
        range: [289, 7, 310, 19],
        call: "boardOf(950, 1060)",
        callLine: 833,
        stylePath: "kit.tsx"
      }
    };
    expect(referenceBlock(facts).split("\n")).toContain(
      "source: settings.tsx:290 · style: boardOf(950, 1060) kit.tsx:833 · texture: ui.panel-signboard"
    );
  });

  it("prints a call as the style, and the last edge without a frame", () => {
    const facts: ReferenceFacts = {
      ...bare(BOARD),
      source: {
        kind: "call",
        path: "kit.tsx",
        line: 3,
        range: [2, 5, 8, 13],
        call: "boardOf(950, 1060)",
        callLine: 4
      },
      last: { path: "home", outcome: "play" }
    };
    const lines = referenceBlock(facts).split("\n");
    expect(lines).toContain(
      "source: kit.tsx:3 · style: boardOf(950, 1060) kit.tsx:4 · texture: ui.panel-signboard"
    );
    expect(lines).toContain("last: home → play");
  });

  it("keeps a style identifier whose block was not found yet without a place", () => {
    const facts: ReferenceFacts = { ...FULL, block: undefined };
    expect(referenceBlock(facts).split("\n")[2]).toBe(
      "source: features/settings/settings.tsx:309 · style: settingsPane · texture: ui.panel-parchment"
    );
  });

  it("prints a pick without a crop as the frame only, and one without a shot as restore only", () => {
    const noCrop = referenceBlock({
      ...FULL,
      pick: { bookmark: "a-f1", crop: undefined, full: ".moku/captures/f1841.png" }
    });
    expect(noCrop.split("\n").at(-1)).toBe("frame: .moku/captures/f1841.png");
    const noShot = referenceBlock({
      ...FULL,
      pick: { bookmark: "a-f1", crop: undefined, full: undefined }
    });
    expect(noShot.split("\n").at(-1)).toBe("restore: bookmark a-f1");
  });
});

describe("sourceText", () => {
  it("is file:line of the line the index answered (strip.tsx:216 for card0, D-47)", () => {
    expect(sourceText({ kind: "defined", path: "a.tsx", line: 3, range: [3, 1, 3, 9] })).toBe(
      "a.tsx:3"
    );
    const card: StyleSource = {
      kind: "call",
      path: "features/orders/strip.tsx",
      line: 216,
      range: [215, 5, 247, 14],
      call: "orderCardStyle(card.slot)",
      callLine: 218
    };
    expect(sourceText(card)).toBe("features/orders/strip.tsx:216");
  });
});

describe("flowNodeOf", () => {
  it("is flow/node when both are known, else the position path", () => {
    expect(
      flowNodeOf({ path: "board/settingsPopup/open", flow: "settingsPopup", node: "open" })
    ).toBe("settingsPopup/open");
    expect(flowNodeOf({ path: "board/awaitIntent", flow: "board" })).toBe("board/awaitIntent");
    expect(flowNodeOf({})).toBeUndefined();
  });
});

describe("rectText", () => {
  it("rounds a rect as x,y w×h", () => {
    expect(rectText({ x: 235.4, y: 74, w: 290.4, h: 75.6 })).toBe("235,74 290×76");
  });
});

/**
 * A number rounded.
 *
 * @param value - A number.
 * @returns It rounded, 0 when absent.
 */
function round(value: number | undefined): number {
  return Math.round(value ?? 0);
}

/**
 * The bounds field text of a node.
 *
 * @param node - The node.
 * @returns "x,y w×h px · ref x,y w×h".
 */
function boundsOf(node: SceneNode): string {
  const rect = node.rect ?? { x: 0, y: 0, w: 0, h: 0 };
  const ref = node.refRect ?? { x: 0, y: 0, w: 0, h: 0 };
  return `${round(rect.x)},${round(rect.y)} ${round(rect.w)}×${round(rect.h)} px · ref ${round(ref.x)},${round(ref.y)} ${round(ref.w)}×${round(ref.h)}`;
}

/**
 * The components of an entity node, at most five, as the path line names them.
 *
 * @param node - The node.
 * @returns "A, B, C".
 */
function componentsOf(node: SceneNode): string {
  return (node.entity?.components ?? []).slice(0, 5).join(", ");
}
