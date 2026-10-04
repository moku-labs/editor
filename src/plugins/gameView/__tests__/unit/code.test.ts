import { describe, expect, it, vi } from "vitest";
import type { SceneNode } from "../../../panels/shared/scene";
import { elementCode, shortValue } from "../../element/code";
import { matchProjection } from "../../element/spawn";
import { missing } from "../files-store";
import { createCtx, sceneCapture, type TestCtx } from "../helpers";
import { boardScene } from "../ui";

const HUD = 'import { coinPill } from "./styles";\n<Pill key="coinPill" style={coinPill} />\n';
const STYLES = "export const coinPill = defineStyle({\n  height: 76,\n  radius: 38\n});\n";
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
 * A ctx whose files hold the coin pill and the board items projection.
 *
 * @param files - Extra or other files.
 * @returns The ctx.
 */
function ctxWith(files: Readonly<Record<string, string>> = {}): TestCtx {
  return createCtx({
    "src/hud/Hud.tsx": HUD,
    "src/hud/styles.ts": STYLES,
    "features/board/items.tsx": ITEMS,
    ...files
  });
}

describe("shortValue (round 2b R12)", () => {
  it("prints a component value on one line, cut at 48 characters", () => {
    expect(shortValue({ name: "items" })).toBe("name items");
    expect(shortValue({ x: 485, y: 191, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } })).toBe(
      "x 485 · y 191 · rotation 0 · scale 1 · pivot x 0…"
    );
  });
});

describe("matchProjection (round 2b R12)", () => {
  it("prefers the name inside a projection({…}) call, else the first line that names it", () => {
    expect(matchProjection(ITEMS, "board.items")).toEqual({ line: 4, inCall: true });
    expect(matchProjection('const a = { name: "board.items" };', "board.items")).toEqual({
      line: 1,
      inCall: false
    });
    expect(matchProjection('name: "board-items"', "board.items")).toBeUndefined();
  });
});

describe("elementCode of a ui element (round 2b R12)", () => {
  it("reads the JSX of the element and the defineStyle block of style={ident}", async () => {
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

  it("has no style block for an element without a style", async () => {
    const ctx = ctxWith({ "src/hud/Hud.tsx": '<Pill key="coinPill" />\n' });
    expect(await elementCode(ctx, coinPill())).toEqual({
      kind: "ui",
      jsx: { path: "src/hud/Hud.tsx", line: 1, lines: ['<Pill key="coinPill" />'] },
      style: undefined
    });
  });

  it("is undefined when no file names the key or the node has no key", async () => {
    const ctx = ctxWith({ "src/hud/Hud.tsx": "nothing\n" });
    expect(await elementCode(ctx, coinPill())).toBeUndefined();
    const unkeyed = { ...coinPill(), key: undefined };
    expect(await elementCode(ctxWith(), unkeyed)).toBeUndefined();
  });
});

describe("elementCode of an entity (round 2b R12)", () => {
  it("searches a found projection once", async () => {
    const ctx = ctxWith();
    const list = vi.spyOn(ctx.link.files, "list");
    await elementCode(ctx, nodeOf("entity:1048628"));
    const lists = list.mock.calls.length;
    await elementCode(ctx, nodeOf("entity:1048628"));
    expect(lists).toBeGreaterThan(0);
    expect(list.mock.calls.length).toBe(lists);
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

  it("leaves the spawn line out when no source defines the projection; looks again next time", async () => {
    const ctx = ctxWith({ "features/board/items.tsx": "nothing\n" });
    const first = await elementCode(ctx, nodeOf("entity:1048628"));
    expect(first?.kind === "entity" ? first.spawn : "?").toBeUndefined();

    ctx.link.files.put("features/board/items.tsx", ITEMS);
    const second = await elementCode(ctx, nodeOf("entity:1048628"));
    expect(second?.kind === "entity" ? second.spawn : "?").toEqual({
      path: "features/board/items.tsx",
      line: 4
    });
    expect(first?.kind === "entity" ? first.components.map(row => row.value)[0] : "?").toBe("");
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

  it("shows the text style key block from the file that calls defineTextStyles", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": TEXT_HUD, "features/ui/styles.ts": TEXT_STYLES });
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
  });

  it("searches the styles file once", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": TEXT_HUD, "features/ui/styles.ts": TEXT_STYLES });
    await elementCode(ctx, coinPill());
    const read = vi.spyOn(ctx.link.files, "read");
    const list = vi.spyOn(ctx.link.files, "list");
    const code = await elementCode(ctx, coinPill());
    expect(code?.kind === "ui" ? code.style?.name : "?").toBe("ui.link");
    expect(list).not.toHaveBeenCalled();
    expect(read.mock.calls.map(call => call[0])).toEqual([
      "src/hud/Hud.tsx",
      "features/ui/styles.ts"
    ]);
  });

  it("has no style block when no file defines the key or calls defineTextStyles", async () => {
    const other = TEXT_STYLES.replace('"ui.link"', '"ui.other"');
    const noKey = createCtx({ "src/hud/Hud.tsx": TEXT_HUD, "features/ui/styles.ts": other });
    const code = await elementCode(noKey, coinPill());
    expect(code?.kind === "ui" ? code.style : "?").toBeUndefined();
    expect(code?.kind === "ui" ? code.jsx?.line : "?").toBe(1);

    const none = createCtx({ "src/hud/Hud.tsx": TEXT_HUD });
    const bare = await elementCode(none, coinPill());
    expect(bare?.kind === "ui" ? bare.style : "?").toBeUndefined();
  });

  it("looks for the styles file again when the remembered one is gone", async () => {
    const ctx = createCtx({ "src/hud/Hud.tsx": TEXT_HUD, "features/ui/styles.ts": TEXT_STYLES });
    await elementCode(ctx, coinPill());
    ctx.link.files.put("features/text/styles.ts", TEXT_STYLES);
    const read = ctx.link.files.read.bind(ctx.link.files);
    vi.spyOn(ctx.link.files, "read").mockImplementation(path =>
      path === "features/ui/styles.ts" ? Promise.reject(missing(path)) : read(path)
    );
    const code = await elementCode(ctx, coinPill());
    expect(code?.kind === "ui" ? code.style?.path : "?").toBe("features/text/styles.ts");
  });
});
