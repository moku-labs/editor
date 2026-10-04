import { describe, expect, it } from "vitest";
import type { SceneNode } from "../../../panels/shared/scene";
import type { ReferenceFacts } from "../../reference/block";
import { cardText, referenceLine } from "../../reference/card";
import type { ElementCode } from "../../types";
import { templateOf } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The compact reference and its card file (round 2b R13), pure: one line for
// the clipboard, the markdown card with the full block, the snippets and the
// image links.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A node of the board fixture.
 *
 * @param id - Its id.
 * @returns The node.
 */
function nodeOf(id: string): SceneNode {
  const node = boardScene().nodes.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

const COIN = nodeOf("ui:boardScreen/hudRow/coinPill");
const ITEM = nodeOf("entity:1048628");

/**
 * The facts of a node at board/awaitIntent, frame 1842.
 *
 * @param node - The node.
 * @param extra - Facts to change.
 * @returns The facts.
 */
function factsOf(node: SceneNode, extra: Partial<ReferenceFacts> = {}): ReferenceFacts {
  return {
    node,
    parents: [],
    position: { path: "board/awaitIntent", flow: "board", node: "awaitIntent" },
    last: undefined,
    source: { kind: "defined", path: "src/hud/Hud.tsx", line: 2 },
    block: undefined,
    flags: [],
    value: undefined,
    frame: 1842,
    game: {
      name: undefined,
      session: undefined,
      at: undefined,
      status: undefined,
      tainted: undefined
    },
    device: undefined,
    pick: {
      bookmark: "coinPill-f1841",
      crop: ".moku/captures/coinPill-f1842.png",
      full: ".moku/captures/f1842.png"
    },
    ...extra
  };
}

/** The code of the coin pill: its JSX and its style block. */
const UI_CODE: ElementCode = {
  kind: "ui",
  jsx: { path: "src/hud/Hud.tsx", line: 2, lines: ['<Pill key="coinPill" style={coinPill} />'] },
  style: {
    path: "src/hud/styles.ts",
    line: 1,
    lines: ["export const coinPill = defineStyle({", "  height: 76", "});"],
    name: "coinPill"
  }
};

/** The code of a board item. */
const ENTITY_CODE: ElementCode = {
  kind: "entity",
  projection: "board.items",
  spawn: { path: "features/board/items.tsx", line: 4 },
  components: [
    { name: "Layer", value: "name items" },
    { name: "Order", value: "value 11" }
  ]
};

const CARD = ".moku/captures/coinPill-f1842.md";
const REF = COIN.refRect;

describe("referenceLine (round 2b R13)", () => {
  it("is one line: name type, flow/node, file:line, ref bounds and the card", () => {
    expect(REF).toBeDefined();
    const ref = `${Math.round(REF?.x ?? 0)},${Math.round(REF?.y ?? 0)} ${Math.round(REF?.w ?? 0)}×${Math.round(REF?.h ?? 0)}`;
    expect(referenceLine(factsOf(COIN), UI_CODE, CARD)).toBe(
      `@moku coinPill row · board/awaitIntent · src/hud/Hud.tsx:2 · ref ${ref} · ${CARD}`
    );
  });

  it("leaves out what is not known; marks a loop key", () => {
    const loose = factsOf(
      { ...COIN, refRect: undefined },
      { position: {}, source: { kind: "defined", path: "a.tsx", line: 9, loop: true } }
    );
    expect(referenceLine(loose, undefined, undefined)).toBe("@moku coinPill row · a.tsx:9 (loop)");
    expect(referenceLine(factsOf(COIN, { source: undefined }), undefined, undefined)).toMatch(
      /^@moku coinPill row · board\/awaitIntent · ref \d+,\d+ \d+×\d+$/
    );
  });

  it("names an entity by the line that defines its projection", () => {
    const line = referenceLine(factsOf(ITEM, { source: undefined }), ENTITY_CODE, CARD);
    expect(line).toMatch(
      new RegExp(
        String.raw`^@moku ${ITEM.name} ${ITEM.type} · board/awaitIntent · features/board/items\.tsx:4 · ref `
      )
    );
    expect(line.endsWith(` · ${CARD}`)).toBe(true);
  });
});

describe("cardText (round 2b R13)", () => {
  it("holds the full block, the JSX and the style with file:line, and the two images", () => {
    const text = cardText(
      "@moku coinPill · row · board/awaitIntent · f1842\npath: x",
      factsOf(COIN),
      UI_CODE
    );
    expect(text.split("\n")).toEqual([
      "# @moku coinPill row",
      "",
      "```text",
      "@moku coinPill · row · board/awaitIntent · f1842",
      "path: x",
      "```",
      "",
      "## JSX · src/hud/Hud.tsx:2",
      "",
      "```tsx",
      '<Pill key="coinPill" style={coinPill} />',
      "```",
      "",
      "## Style · coinPill · src/hud/styles.ts:1",
      "",
      "```ts",
      "export const coinPill = defineStyle({",
      "  height: 76",
      "});",
      "```",
      "",
      "![element](coinPill-f1842.png)",
      "![frame](f1842.png)",
      ""
    ]);
  });

  it("names an entity's projection and lists its components", () => {
    const text = cardText("@moku i1", factsOf(ITEM, { pick: undefined }), ENTITY_CODE);
    expect(text).toContain("## Spawned by board.items · features/board/items.tsx:4\n");
    expect(text).toContain("- Layer: name items\n- Order: value 11\n");
    expect(text).not.toContain("![");
  });

  it("fences a snippet that holds backticks with a longer fence", () => {
    const code: ElementCode = {
      kind: "ui",
      jsx: { path: "a.tsx", line: 1, lines: [`<Card key={${templateOf("card", "i")}} />`, "```"] },
      style: undefined
    };
    const text = cardText("@moku card0", factsOf(COIN, { pick: undefined }), code);
    expect(text).toContain("````tsx\n");
    expect(text).toContain("```\n````\n");
  });
});
