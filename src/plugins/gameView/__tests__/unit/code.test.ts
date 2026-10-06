import { describe, expect, it, vi } from "vitest";
import type { SceneNode } from "../../../panels/shared/scene";
import { elementCode, shortValue } from "../../element/code";
import { onProjectChange } from "../../handlers";
import { answer, createCtx, place, projectOn, sceneCapture, type TestCtx } from "../helpers";
import { boardScene } from "../ui";

const HUD = 'import { coinPill } from "./styles";\n<Pill key="coinPill" style={coinPill} />\n';
const STYLES = "export const coinPill = defineStyle({\n  height: 76,\n  radius: 38\n});\n";
/** The style key of the style function `boardStyle` in features/ui/kit.tsx (G2). */
const BOARD_STYLE = "style:features/ui/kit.tsx#boardStyle";
const ITEMS = [
  'import { projection } from "../../kit";',
  'const style = { name: "board.items" };',
  "export const boardItems = projection({",
  '  name: "board.items",',
  '  layer: "world"',
  "});"
].join("\n");

/**
 * A node of the board fixture by id.
 *
 * @param id - The scene node id.
 * @returns The node.
 */
function nodeOf(id: string): SceneNode {
  const node = boardScene().nodes.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

/**
 * The coin pill node of the fixture.
 *
 * @returns The node.
 */
function coinPill(): SceneNode {
  return nodeOf("ui:boardScreen/hudRow/coinPill");
}

/**
 * A ctx whose files hold the coin pill and the board items projection, and whose index answers
 * them.
 *
 * @param files - Extra or other files.
 * @returns The ctx.
 */
function ctxWith(files: Readonly<Record<string, string>> = {}): TestCtx {
  const ctx = createCtx({
    "src/hud/Hud.tsx": HUD,
    "src/hud/styles.ts": STYLES,
    "features/board/items.tsx": ITEMS,
    ...files
  });
  ctx.link.projectValue = projectOn({
    "style:src/hud/styles.ts#coinPill": ["src/hud/styles.ts"],
    "projection:board.items": ["features/board/items.tsx"]
  });
  answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42]));
  answer(ctx, "projection:board.items", place("features/board/items.tsx", [4, 3, 4, 22]));
  return ctx;
}

describe("shortValue (round 2b R12)", () => {
  it("prints a component value on one line, cut at 48 characters", () => {
    expect(shortValue({ name: "items" })).toBe("name items");
    expect(shortValue({ x: 485, y: 191, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } })).toBe(
      "x 485 · y 191 · rotation 0 · scale 1 · pivot x 0…"
    );
  });
});

describe("elementCode of a ui element (round 2b R12)", () => {
  it("reads the JSX of the element's range and the defineStyle block of style={ident}", async () => {
    const code = await elementCode(ctxWith(), coinPill());
    expect(code).toEqual({
      kind: "ui",
      jsx: {
        path: "src/hud/Hud.tsx",
        line: 2,
        lines: ['<Pill key="coinPill" style={coinPill} />']
      },
      style: {
        path: "src/hud/styles.ts",
        line: 1,
        lines: ["export const coinPill = defineStyle({", "  height: 76,", "  radius: 38", "});"],
        name: "coinPill"
      }
    });
  });

  it("starts the JSX at the range start, the line before the key attribute", async () => {
    const ctx = ctxWith({
      "src/hud/Hud.tsx": '<Row>\n  <HudPill\n    id="coinPill"\n  />\n</Row>'
    });
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 3, 4, 5], { line: 3 }));
    expect(await elementCode(ctx, coinPill())).toEqual({
      kind: "ui",
      jsx: { path: "src/hud/Hud.tsx", line: 2, lines: ["  <HudPill", '    id="coinPill"', "  />"] },
      style: undefined
    });
  });

  it("shows the defineStyle call of a style function the index knows (G2)", async () => {
    const kit = [
      "function boardStyle(width: number) {",
      "  return defineStyle({ width, gap: 4 });",
      "}",
      '<panel key="coinPill" style={boardStyle(950)} />'
    ].join("\n");
    const ctx = ctxWith({ "features/ui/kit.tsx": kit });
    ctx.link.projectValue = projectOn({
      "style:features/ui/kit.tsx#boardStyle": ["features/ui/kit.tsx"]
    });
    answer(ctx, "jsx:coinPill", place("features/ui/kit.tsx", [4, 1, 4, 49]));
    answer(
      ctx,
      "style:features/ui/kit.tsx#boardStyle",
      place("features/ui/kit.tsx", [2, 10, 2, 41])
    );
    const code = await elementCode(ctx, coinPill());
    expect(code?.kind === "ui" ? code.style : "?").toEqual({
      path: "features/ui/kit.tsx",
      line: 2,
      lines: ["  return defineStyle({ width, gap: 4 });"],
      name: "boardStyle"
    });
  });

  it("asks the index for a call style once, and again after a change of its file (D-46)", async () => {
    const kit = [
      "function boardStyle(width: number) {",
      "  return defineStyle({ width, gap: 4 });",
      "}",
      '<panel key="coinPill" style={boardStyle(950)} />'
    ].join("\n");
    const ctx = ctxWith({ "features/ui/kit.tsx": kit });
    ctx.link.projectValue = projectOn({ [BOARD_STYLE]: ["features/ui/kit.tsx"] });
    answer(ctx, "jsx:coinPill", place("features/ui/kit.tsx", [4, 1, 4, 49]));
    answer(ctx, BOARD_STYLE, place("features/ui/kit.tsx", [2, 10, 2, 41]));
    const find = vi.spyOn(ctx.link.files, "find");
    const styleAsks = (): number => find.mock.calls.filter(([key]) => key === BOARD_STYLE).length;

    const first = await elementCode(ctx, coinPill());
    const again = await elementCode(ctx, coinPill());
    expect(again).toEqual(first);
    expect(styleAsks()).toBe(1);
    expect(ctx.state.blocks.get(BOARD_STYLE)).toEqual({
      path: "features/ui/kit.tsx",
      line: 2,
      range: [2, 10, 2, 41]
    });

    ctx.link.files.put("features/ui/kit.tsx", `// moved down\n${kit}`);
    answer(ctx, "jsx:coinPill", place("features/ui/kit.tsx", [5, 1, 5, 49]));
    answer(ctx, BOARD_STYLE, place("features/ui/kit.tsx", [3, 10, 3, 41]));
    onProjectChange(ctx)({
      state: projectOn({ [BOARD_STYLE]: ["features/ui/kit.tsx"] }, { revision: "r2" }),
      delta: { all: false, files: ["features/ui/kit.tsx"], moved: [], removed: [] }
    });

    const moved = await elementCode(ctx, coinPill());
    expect(styleAsks()).toBe(2);
    expect(moved?.kind === "ui" ? moved.style?.line : "?").toBe(3);
  });

  it("has no style block for a call the index has no style key for", async () => {
    const ctx = ctxWith({ "src/hud/Hud.tsx": '<Pill key="coinPill" style={pillOf(2)} />\n' });
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [1, 1, 1, 42]));
    const code = await elementCode(ctx, coinPill());
    expect(code?.kind === "ui" ? code.style : "?").toBeUndefined();
    expect(code?.kind === "ui" ? code.jsx?.line : "?").toBe(1);
  });

  it("is undefined for a key the index does not know or a node without a key", async () => {
    const ctx = ctxWith();
    ctx.link.files.answers.delete("jsx:coinPill");
    expect(await elementCode(ctx, coinPill())).toBeUndefined();
    const unkeyed = { ...coinPill(), key: undefined };
    expect(await elementCode(ctxWith(), unkeyed)).toBeUndefined();
  });
});

describe("elementCode of an entity (round 2b R12)", () => {
  it("asks the index for a found projection once", async () => {
    const ctx = ctxWith();
    const find = vi.spyOn(ctx.link.files, "find");
    await elementCode(ctx, nodeOf("entity:1048628"));
    await elementCode(ctx, nodeOf("entity:1048628"));
    expect(find.mock.calls).toEqual([["projection:board.items"]]);
  });

  it("names the projection, the line that defines it and the components with their values", async () => {
    const ctx = ctxWith();
    ctx.state.sources.entities = sceneCapture("scene-board.txt").entities;
    const code = await elementCode(ctx, nodeOf("entity:1048628"));
    expect(code?.kind).toBe("entity");
    if (code?.kind !== "entity") return;
    expect(code.projection).toBe("board.items");
    expect(code.spawn).toEqual({ path: "features/board/items.tsx", line: 4 });
    expect(code.components.slice(0, 4)).toEqual([
      { name: "Layer", value: "name items" },
      { name: "Transform", value: "x 485 · y 191 · rotation 0 · scale 1 · pivot x 0…" },
      { name: "Order", value: "value 11" },
      { name: "Parent", value: "entity 1048703" }
    ]);
  });

  it("leaves the spawn line out when the index does not know the projection; asks again next time", async () => {
    const ctx = ctxWith();
    ctx.link.files.answers.delete("projection:board.items");
    const first = await elementCode(ctx, nodeOf("entity:1048628"));
    expect(first?.kind === "entity" ? first.spawn : "?").toBeUndefined();

    answer(ctx, "projection:board.items", place("features/board/items.tsx", [4, 3, 4, 22]));
    const second = await elementCode(ctx, nodeOf("entity:1048628"));
    expect(second?.kind === "entity" ? second.spawn : "?").toEqual({
      path: "features/board/items.tsx",
      line: 4
    });
    expect(first?.kind === "entity" ? first.components.map(row => row.value)[0] : "?").toBe("");
  });

  it("leaves the spawn line out when the index is off (find rejects)", async () => {
    const ctx = ctxWith();
    vi.spyOn(ctx.link.files, "find").mockRejectedValue(new Error("project index off: disabled"));
    const code = await elementCode(ctx, nodeOf("entity:1048628"));
    expect(code?.kind === "entity" ? code.spawn : "?").toBeUndefined();
  });
});

describe("elementCode of a text node (round 2b R17)", () => {
  const TEXT_HUD = '<text key="coinPill" style="ui.link" content={tr("reset")} />\n';
  const TEXT_STYLES = [
    'import { defineTextStyles } from "../../kit";',
    "export const uiStyles = defineTextStyles({",
    '  "ui.title": { size: 64 },',
    '  "ui.link": {',
    "    size: 40,",
    "    fill: berry",
    "  }",
    "});"
  ].join("\n");

  /**
   * A ctx with the text node and the text styles, answered by the index.
   *
   * @returns The ctx.
   */
  function textCtx(): TestCtx {
    const ctx = createCtx({ "src/hud/Hud.tsx": TEXT_HUD, "features/ui/styles.ts": TEXT_STYLES });
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [1, 1, 1, 63]));
    answer(ctx, "textStyle:ui.link", place("features/ui/styles.ts", [4, 3, 7, 4]));
    return ctx;
  }

  it("shows the block of the text style key where the index answers it", async () => {
    const ctx = textCtx();
    const find = vi.spyOn(ctx.link.files, "find");
    expect(await elementCode(ctx, coinPill())).toEqual({
      kind: "ui",
      jsx: { path: "src/hud/Hud.tsx", line: 1, lines: [TEXT_HUD.trim()] },
      style: {
        path: "features/ui/styles.ts",
        line: 4,
        lines: ['  "ui.link": {', "    size: 40,", "    fill: berry", "  }"],
        name: "ui.link"
      }
    });
    expect(find).toHaveBeenCalledWith("textStyle:ui.link");
  });

  it("has no style block when the index does not know the text style key", async () => {
    const ctx = textCtx();
    ctx.link.files.answers.delete("textStyle:ui.link");
    const code = await elementCode(ctx, coinPill());
    expect(code?.kind === "ui" ? code.style : "?").toBeUndefined();
    expect(code?.kind === "ui" ? code.jsx?.line : "?").toBe(1);
  });
});
