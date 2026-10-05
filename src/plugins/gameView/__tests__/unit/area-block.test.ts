import { describe, expect, it } from "vitest";
import type { SceneNode } from "../../../panels/shared/scene";
import {
  type AreaFacts,
  areaBlock,
  areaCardText,
  areaHead,
  itemLine
} from "../../reference/area-block";
import { type TailFacts, tailLines } from "../../reference/block";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The area block (U9, A17), pure: the head `@moku area <w>×<h> · <flow node> ·
// <N> elements · ref x,y w×h · <card>`, one line per group element in the
// one-line form, "+N more" past the cap, then the tail lines a single
// element's block ends with (flow, game, device, restore, shot).
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

/** The tail every block here ends with. */
const TAIL: TailFacts = {
  position: { path: "board/awaitIntent", flow: "board", node: "awaitIntent" },
  last: { path: "board/merge", outcome: "merged", frame: 1830 },
  frame: 25,
  game: {
    name: "merge-game 0.0.0",
    session: "s-1",
    at: new Date(2026, 9, 5, 9, 5, 7),
    status: "live",
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
    bookmark: "area-f25",
    crop: ".moku/captures/area-f25-crop.jpg",
    full: ".moku/captures/f25-full.jpg"
  }
};

/**
 * The facts of the hud area: the home button and the coin pill.
 *
 * @param overrides - Fields to replace.
 * @returns The facts.
 */
function hudArea(overrides: Partial<AreaFacts> = {}): AreaFacts {
  return {
    ...TAIL,
    area: { x: 30.4, y: 45, w: 519.6, h: 135 },
    refArea: { x: 30.4, y: 45, w: 519.6, h: 135 },
    items: [
      { node: nodeOf("ui:boardScreen/hudRow/home"), source: undefined },
      {
        node: nodeOf("ui:boardScreen/hudRow/coinPill"),
        source: { kind: "defined", path: "src/hud/Hud.tsx", line: 2 }
      }
    ],
    total: 2,
    ...overrides
  };
}

describe("areaHead", () => {
  it("names the size, the flow node, the count, the area in reference units and the card", () => {
    expect(areaHead(hudArea(), ".moku/captures/area-f25.md")).toBe(
      "@moku area 520×135 · board/awaitIntent · 2 elements · ref 30,45 520×135 · .moku/captures/area-f25.md"
    );
  });

  it("leaves out ref when the scene is not calibrated, and the card when none was written", () => {
    expect(areaHead(hudArea({ refArea: undefined, position: {} }), undefined)).toBe(
      "@moku area 520×135 · 2 elements"
    );
  });

  it("counts one element, and says no elements for an empty area", () => {
    const [first] = hudArea().items;
    expect(areaHead(hudArea({ items: first ? [first] : [], total: 1 }), undefined)).toContain(
      " · 1 element · "
    );
    expect(areaHead(hudArea({ items: [], total: 0 }), undefined)).toContain(" · no elements · ");
  });
});

describe("itemLine", () => {
  it("prints name, type, key, file:line and the reference rect", () => {
    const [, coin] = hudArea().items;
    expect(coin && itemLine(coin)).toBe(
      "- coinPill row · key coinPill · src/hud/Hud.tsx:2 · ref 235,74 290×76"
    );
  });

  it("an entity has no key; an unplaced node no rect", () => {
    expect(itemLine({ node: nodeOf("entity:1048628"), source: undefined })).toBe(
      "- i1 Sprite · ref 429,881 223×223"
    );
    const unplaced = { ...nodeOf("ui:boardScreen/hudRow/home"), refRect: undefined };
    expect(itemLine({ node: unplaced, source: undefined })).toBe("- home button · key home");
  });
});

describe("areaBlock", () => {
  it("is the head, one line per element, then the tail lines", () => {
    const block = areaBlock(hudArea(), ".moku/captures/area-f25.md").split("\n");
    expect(block).toEqual([
      "@moku area 520×135 · board/awaitIntent · 2 elements · ref 30,45 520×135 · .moku/captures/area-f25.md",
      "- home button · key home · ref 40,52 120×120",
      "- coinPill row · key coinPill · src/hud/Hud.tsx:2 · ref 235,74 290×76",
      "flow: board > awaitIntent · last: board/merge → merged (f1830)",
      "game: merge-game 0.0.0 · s-1 · f25 · 09:05:07 · live · clean",
      "device: iPhone 15 393×852 portrait · dpr 3 · safe 59/0/34/0",
      "restore: bookmark area-f25",
      "shot: .moku/captures/area-f25-crop.jpg · frame: .moku/captures/f25-full.jpg"
    ]);
  });

  it("says how many more elements the cap left out", () => {
    const block = areaBlock(hudArea({ total: 45 }), undefined).split("\n");
    expect(block[0]).toContain(" · 45 elements");
    expect(block[3]).toBe("+43 more");
  });
});

describe("tailLines (A17)", () => {
  it("are the flow, game, device, restore and shot lines, unknown ones undefined", () => {
    expect(tailLines({ ...TAIL, last: undefined, pick: undefined })).toEqual([
      "flow: board > awaitIntent",
      "game: merge-game 0.0.0 · s-1 · f25 · 09:05:07 · live · clean",
      "device: iPhone 15 393×852 portrait · dpr 3 · safe 59/0/34/0",
      undefined,
      undefined
    ]);
  });
});

describe("areaCardText", () => {
  it("has a heading, the block in a text fence, the code of the elements and the pictures", () => {
    const facts = hudArea();
    const coin = nodeOf("ui:boardScreen/hudRow/coinPill");
    const text = areaCardText("@moku area 520×135\n- coinPill row", facts, [
      {
        node: coin,
        code: {
          kind: "ui",
          jsx: { path: "src/hud/Hud.tsx", line: 2, lines: ['<Pill key="coinPill" />'] },
          style: undefined
        }
      }
    ]);
    expect(text).toBe(
      [
        "# @moku area 520×135",
        "",
        "```text",
        "@moku area 520×135",
        "- coinPill row",
        "```",
        "",
        "## coinPill · JSX · src/hud/Hud.tsx:2",
        "",
        "```tsx",
        '<Pill key="coinPill" />',
        "```",
        "",
        "![area](area-f25-crop.jpg)",
        "![frame](f25-full.jpg)",
        ""
      ].join("\n")
    );
  });

  it("has no picture section without a shot", () => {
    const text = areaCardText("@moku area 1×1", hudArea({ pick: undefined }), []);
    expect(text).toBe("# @moku area 520×135\n\n```text\n@moku area 1×1\n```\n");
  });
});
