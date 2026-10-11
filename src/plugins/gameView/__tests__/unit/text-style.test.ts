// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findBlock, parseStyleFile } from "../../../panels/shared/style-edit";
import type { SelectionInfo } from "../../../registry/protocol";
import {
  clearEdits,
  copyEdits,
  dropSessionEdits,
  editStyle,
  editTextStyle,
  listEdits
} from "../../element/edit-style";
import {
  editsText,
  isTextStyleEditKey,
  selectionEdits,
  textStyleEditKey
} from "../../element/edits";
import { selectElement } from "../../element/select";
import { openTextStyle, rowsOf } from "../../element/text-styles";
import { onProjectChange } from "../../handlers";
import { rebuildScene } from "../../scene/rebuild";
import type { ElementEdits } from "../../types";
import { answer, createCtx, flush, place, projectOn, type TestCtx, useScene } from "../helpers";
import { boardCaptureWith, boardScene, sceneOf } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The text style of a text node (D-73, addendum 4): the engine sends the key
// (`UiNode.textStyle`, @moku-labs/game 0.14.11), the scene keeps it, the block
// of the key is read through the project index, and an edit of one of its
// fields is a pending edit of the STYLE KEY: kept under `textStyle:<key>`,
// written to the agent as its own block, published with the selection of every
// text node that has the key, and resolved when the block read again shows it.
// ─────────────────────────────────────────────────────────────────────────────

const AMOUNT = { kind: "ui", path: "boardScreen/hudRow/coinPill/coinPillText" } as const;
const COIN = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;
const FILE = "shared/styles/text.ts";

/** A text styles file as ticktoe writes it: a shorthand, tokens, a nested shadow. */
const TEXT = [
  'import { colors } from "./tokens";',
  "export const uiStyles = defineTextStyles({",
  '  "ui.amount": {',
  "    font,",
  "    size: 105,",
  '    align: "center",',
  "    fill: colors.cream,",
  "    digits: true,",
  "    shadow: { color: creamShade, dx: 0, dy: 6, alpha: 0.55 }",
  "  },",
  '  "ui.link": { size: 40 }',
  "});",
  ""
].join("\n");

let ctx: TestCtx;

/**
 * The board with the text of the coin pill given a text style key, as an engine ≥ 0.14.11 sends
 * it.
 *
 * @param key - The text style key.
 * @returns The capture.
 */
function boardWithTextStyle(key: string): ReturnType<typeof boardCaptureWith> {
  return boardCaptureWith("coinPillText", node => {
    node.textStyle = key;
  });
}

/**
 * Every value gameView published, in order.
 *
 * @returns The params of each `notify("selection", …)`.
 */
function published(): (SelectionInfo | null)[] {
  return ctx.link.notify.mock.calls.map(([, params]) => params);
}

/**
 * The edits kept for a map key.
 *
 * @param key - The ui key, the node id or `textStyle:<key>`.
 * @returns The entry.
 */
function kept(key: string): ElementEdits | undefined {
  return ctx.state.edits.get(key);
}

/**
 * Selects the amount text and reads its text style block.
 */
async function openAmount(): Promise<void> {
  selectElement(ctx, AMOUNT);
  await openTextStyle(ctx);
  ctx.link.notify.mockClear();
}

/**
 * The agent writes the styles file and the index tells the editor.
 *
 * @param text - The new text of the styles file.
 */
async function agentWrites(text: string): Promise<void> {
  ctx.link.files.put(FILE, text);
  const state = projectOn({ "textStyle:ui.amount": [FILE] }, { revision: "r2" });
  ctx.link.projectValue = state;
  onProjectChange(ctx)({
    state,
    delta: { all: false, files: [FILE], moved: [], removed: [] }
  });
  await flush();
}

beforeEach(() => {
  ctx = createCtx({ [FILE]: TEXT });
  ctx.link.projectValue = projectOn({ "textStyle:ui.amount": [FILE], "textStyle:ui.link": [FILE] });
  answer(ctx, "textStyle:ui.amount", place(FILE, [3, 3, 10, 4]));
  const capture = boardWithTextStyle("ui.amount");
  useScene(ctx, capture);
  ctx.state.scene = sceneOf(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scene: the text style key of a ui node", () => {
  it("keeps `textStyle` of the raw node when it is a non-empty string", () => {
    const node = ctx.state.scene?.nodes.get("ui:boardScreen/hudRow/coinPill/coinPillText");
    expect(node?.textStyle).toBe("ui.amount");
  });

  it("drops anything else: an empty string, a number, an object", () => {
    for (const value of ["", 7, { key: "ui.amount" }, ["ui.amount"]]) {
      const scene = sceneOf(
        boardCaptureWith("coinPillText", node => {
          node.textStyle = value;
        })
      );
      const node = scene.nodes.get("ui:boardScreen/hudRow/coinPill/coinPillText");
      expect(node).toBeDefined();
      expect(node !== undefined && "textStyle" in node).toBe(false);
    }
  });

  it("an older engine sends no field: no node has one", () => {
    const nodes = [...boardScene().nodes.values()];
    expect(nodes.some(node => "textStyle" in node)).toBe(false);
  });
});

describe("rowsOf", () => {
  it("a number and a quoted string are values; anything else keeps its source text", () => {
    const file = parseStyleFile(TEXT);
    if ("error" in file) throw new Error("fixture");
    const block = findBlock(file, { kind: "text", key: "ui.amount" });
    if ("error" in block) throw new Error("fixture");

    expect(rowsOf(block)).toEqual([
      { path: "font", raw: "font", value: undefined },
      { path: "size", raw: "105", value: 105 },
      { path: "align", raw: '"center"', value: "center" },
      { path: "fill", raw: "colors.cream", value: undefined },
      { path: "digits", raw: "true", value: undefined },
      { path: "shadow.color", raw: "creamShade", value: undefined },
      { path: "shadow.dx", raw: "0", value: 0 },
      { path: "shadow.dy", raw: "6", value: 6 },
      { path: "shadow.alpha", raw: "0.55", value: 0.55 }
    ]);
  });

  it("a string in single quotes is a value too; a call or a concatenation is not", () => {
    const file = parseStyleFile(
      'defineTextStyles({\n  "ui.a": { align: \'left\', font: fontOf("a"), wrap: "a" + "b" }\n});'
    );
    if ("error" in file) throw new Error("fixture");
    const block = findBlock(file, { kind: "text", key: "ui.a" });
    if ("error" in block) throw new Error("fixture");

    expect(rowsOf(block).map(row => row.value)).toEqual(["left", undefined, undefined]);
  });
});

describe("openTextStyle", () => {
  it("reads the block of the selected text node's key through the project index", async () => {
    selectElement(ctx, AMOUNT);
    const reading = openTextStyle(ctx);
    expect(ctx.state.textStyle).toEqual({ key: "ui.amount", status: "searching" });
    await reading;

    expect(ctx.state.textStyle).toMatchObject({
      key: "ui.amount",
      status: "found",
      path: FILE,
      line: 3
    });
    const card = ctx.state.textStyle;
    expect(card?.status === "found" && card.rows.map(row => row.path)).toEqual([
      "font",
      "size",
      "align",
      "fill",
      "digits",
      "shadow.color",
      "shadow.dx",
      "shadow.dy",
      "shadow.alpha"
    ]);
  });

  it("says missing when the index does not know the key", async () => {
    ctx.link.files.answers.delete("textStyle:ui.amount");
    selectElement(ctx, AMOUNT);
    await openTextStyle(ctx);
    expect(ctx.state.textStyle).toEqual({ key: "ui.amount", status: "missing" });
  });

  it("keeps the place and shows no rows when the block cannot be parsed", async () => {
    ctx.link.files.put(
      FILE,
      "export const uiStyles = defineTextStyles({\n  amount: { size: 1 }\n});"
    );
    answer(ctx, "textStyle:ui.amount", place(FILE, [2, 3, 2, 22]));
    selectElement(ctx, AMOUNT);
    await openTextStyle(ctx);
    expect(ctx.state.textStyle).toMatchObject({ status: "found", path: FILE, line: 2, rows: [] });
  });

  it("two entries with the key in one file: the one at the line the index answers", async () => {
    ctx.link.files.put(
      FILE,
      'const other = {\n  "ui.amount": { size: 1 }\n};\ndefineTextStyles({\n  "ui.amount": { size: 2 }\n});'
    );
    answer(ctx, "textStyle:ui.amount", place(FILE, [5, 3, 5, 26]));
    selectElement(ctx, AMOUNT);
    await openTextStyle(ctx);
    expect(ctx.state.textStyle).toMatchObject({
      status: "found",
      line: 5,
      rows: [{ path: "size", raw: "2", value: 2 }]
    });
  });

  it("has nothing for a node without a text style, and for no selection", async () => {
    selectElement(ctx, COIN);
    await openTextStyle(ctx);
    expect(ctx.state.textStyle).toBeUndefined();

    selectElement(ctx, undefined);
    await openTextStyle(ctx);
    expect(ctx.state.textStyle).toBeUndefined();
  });

  it("an answer for an element that is no longer selected is not shown", async () => {
    selectElement(ctx, AMOUNT);
    const reading = openTextStyle(ctx);
    selectElement(ctx, COIN);
    await reading;
    expect(ctx.state.textStyle?.status).not.toBe("found");
  });
});

describe("editTextStyle: a pending edit of the style key", () => {
  beforeEach(openAmount);

  it("is kept under textStyle:<key>: labelled, at the block, not by id; `from` is the file value", () => {
    editTextStyle(ctx, "ui.amount", "size", 96);

    expect(textStyleEditKey("ui.amount")).toBe("textStyle:ui.amount");
    expect(isTextStyleEditKey("textStyle:ui.amount")).toBe(true);
    expect(isTextStyleEditKey("coinPillText")).toBe(false);
    expect(kept("textStyle:ui.amount")).toEqual({
      label: "textStyle ui.amount",
      source: { path: FILE, line: 3 },
      byId: false,
      edits: [{ path: "size", from: 105, to: 96 }]
    });
    // The node itself has no edit: the key styles many nodes.
    expect(kept("coinPillText")).toBeUndefined();
  });

  it("a second edit replaces `to` and keeps `from`; the file value removes the edit", () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    editTextStyle(ctx, "ui.amount", "size", 90);
    editTextStyle(ctx, "ui.amount", "align", "left");
    expect(kept("textStyle:ui.amount")?.edits).toEqual([
      { path: "size", from: 105, to: 90 },
      { path: "align", from: "center", to: "left" }
    ]);

    editTextStyle(ctx, "ui.amount", "size", 105);
    expect(kept("textStyle:ui.amount")?.edits).toEqual([
      { path: "align", from: "center", to: "left" }
    ]);
    editTextStyle(ctx, "ui.amount", "align", "center");
    expect(ctx.state.edits.size).toBe(0);
  });

  it("does nothing for a read-only row, an unknown field or another key", () => {
    editTextStyle(ctx, "ui.amount", "fill", "colors.plum");
    editTextStyle(ctx, "ui.amount", "digits", false);
    editTextStyle(ctx, "ui.amount", "stroke", 4);
    editTextStyle(ctx, "ui.link", "size", 44);
    expect(ctx.state.edits.size).toBe(0);
  });

  it("the selection of the text node carries them as textStyle:<key>#<field>", () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    editTextStyle(ctx, "ui.amount", "shadow.dy", 8);

    expect(published().at(-1)?.edits).toEqual([
      { path: "textStyle:ui.amount#size", from: 105, to: 96 },
      { path: "textStyle:ui.amount#shadow.dy", from: 6, to: 8 }
    ]);
    // Another element has none of them.
    selectElement(ctx, COIN);
    expect(published().at(-1)?.edits).toBeUndefined();
    // Back on a text node with the key: the same edits again.
    selectElement(ctx, AMOUNT);
    expect(published().at(-1)?.edits).toHaveLength(2);
  });

  it("the edits of the api (`editStyle`) stay the node's: a text style path is none of its style", () => {
    editStyle(ctx, "size", 96);
    editStyle(ctx, "textStyle:ui.amount#size", 96);
    expect(ctx.state.edits.size).toBe(0);
  });

  it("a new game session keeps them: the key is not a node id", () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    dropSessionEdits(ctx);
    expect(kept("textStyle:ui.amount")?.edits).toHaveLength(1);
  });

  it("a scene snapshot does not resolve them: the scene has no value of a text style", () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    rebuildScene(ctx, 1850);
    expect(kept("textStyle:ui.amount")?.edits).toHaveLength(1);
  });

  it("clearEdits('selected') on a text node drops its own edits and the ones of its key", () => {
    selectElement(ctx, COIN);
    editStyle(ctx, "width", 320);
    selectElement(ctx, AMOUNT);
    editTextStyle(ctx, "ui.amount", "size", 96);
    ctx.link.notify.mockClear();

    clearEdits(ctx, "selected");
    expect([...ctx.state.edits.keys()]).toEqual(["coinPill"]);
    expect(published().at(-1)?.edits).toBeUndefined();
  });
});

/** A text of the Play button with the `ui.button` style key and no ui key of its own. */
const LABEL = {
  id: "ui:homeScreen/homePlay/homePlayLabel",
  key: undefined,
  textStyle: "ui.button"
};

/**
 * The pending edits with one entry of the `ui.button` style key.
 *
 * @param edits - The edits of the key.
 * @returns The map of `state.edits`.
 */
function keptFor(edits: ElementEdits["edits"]): Map<string, ElementEdits> {
  const entry = { label: "textStyle ui.button", byId: false, edits };
  return new Map([["textStyle:ui.button", entry]]);
}

describe("selectionEdits: the path of a style key edit", () => {
  it("a plain field is textStyle:<key>#<field>: `#` ends the key, which has dots itself", () => {
    expect(selectionEdits(keptFor([{ path: "size", from: 105, to: 96 }]), LABEL)).toEqual([
      { path: "textStyle:ui.button#size", from: 105, to: 96 }
    ]);
  });

  it("a nested field keeps its own dots after the `#`", () => {
    const [edit] = selectionEdits(keptFor([{ path: "shadow.dy", from: 6, to: 8 }]), LABEL);
    expect(edit).toEqual({ path: "textStyle:ui.button#shadow.dy", from: 6, to: 8 });

    // One split at the first `#` gives the key and the field back.
    const [owner, field] = edit?.path.split("#") ?? [];
    expect([owner, field]).toEqual(["textStyle:ui.button", "shadow.dy"]);
  });

  it("the node's own edits come first and keep their path", () => {
    const kept = keptFor([{ path: "size", from: 105, to: 96 }]);
    kept.set(LABEL.id, {
      label: "homePlayLabel",
      byId: true,
      edits: [{ path: "opacity", from: 1, to: 0.5 }]
    });
    expect(selectionEdits(kept, LABEL).map(edit => edit.path)).toEqual([
      "opacity",
      "textStyle:ui.button#size"
    ]);
  });
});

describe("the agent text with a style key", () => {
  beforeEach(openAmount);

  it("editsText writes the block of a style key like any other", () => {
    expect(
      editsText([
        {
          label: "textStyle ui.button",
          source: { path: "shared/styles/text.ts", line: 88 },
          byId: false,
          edits: [{ path: "size", from: 105, to: 96 }]
        }
      ])
    ).toBe("@moku textStyle ui.button · shared/styles/text.ts:88\nsize: 105 -> 96");
  });

  it("the style key blocks come after the element blocks, whatever was edited first", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    editTextStyle(ctx, "ui.amount", "size", 96);
    selectElement(ctx, COIN);
    editStyle(ctx, "width", 320);
    selectElement(ctx, AMOUNT);

    expect(listEdits(ctx).map(entry => entry.label)).toEqual(["coinPill", "textStyle ui.amount"]);
    expect(await copyEdits(ctx)).toBe(
      `@moku coinPill\nwidth: 290 -> 320\n\n@moku textStyle ui.amount · ${FILE}:3\nsize: 105 -> 96`
    );
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ 2 edits copied");
  });
});

describe("resolve: the block read again shows the wanted value", () => {
  beforeEach(openAmount);

  it("a project delta that touches the file reads the block again and drops the edit it shows", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    editTextStyle(ctx, "ui.amount", "align", "left");
    ctx.link.notify.mockClear();

    await agentWrites(TEXT.replace("size: 105", "size: 96"));

    expect(kept("textStyle:ui.amount")?.edits).toEqual([
      { path: "align", from: "center", to: "left" }
    ]);
    const card = ctx.state.textStyle;
    expect(card?.status === "found" && card.rows.find(row => row.path === "size")?.value).toBe(96);
    expect(published().at(-1)?.edits).toEqual([
      { path: "textStyle:ui.amount#align", from: "center", to: "left" }
    ]);
  });

  it("the last edit resolved forgets the key", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    await agentWrites(TEXT.replace("size: 105", "size: 96"));
    expect(ctx.state.edits.size).toBe(0);
  });

  it("a delta that does not touch the file reads nothing", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    const reads = vi.spyOn(ctx.link.files, "read");
    const state = projectOn({ "textStyle:ui.amount": [FILE] }, { revision: "r2" });
    onProjectChange(ctx)({
      state,
      delta: { all: false, files: ["features/other.ts"], moved: [], removed: [] }
    });
    await flush();
    expect(reads.mock.calls.filter(([path]) => path === FILE)).toHaveLength(0);
    expect(kept("textStyle:ui.amount")?.edits).toHaveLength(1);
  });

  it("the edit of a key resolves while another element is selected", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    selectElement(ctx, COIN);
    await openTextStyle(ctx);
    expect(ctx.state.textStyle).toBeUndefined();

    await agentWrites(TEXT.replace("size: 105", "size: 96"));
    expect(ctx.state.edits.size).toBe(0);
    expect(ctx.state.textStyle).toBeUndefined();
  });

  it("selecting a text node of the key again reads the block and resolves", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    selectElement(ctx, COIN);
    ctx.link.files.put(FILE, TEXT.replace("size: 105", "size: 96"));

    selectElement(ctx, AMOUNT);
    await openTextStyle(ctx);
    expect(ctx.state.edits.size).toBe(0);
  });

  it("the line of the block follows the file: the agent text names where it is now", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    answer(ctx, "textStyle:ui.amount", place(FILE, [5, 3, 12, 4]));
    await agentWrites(`// a note\n// another\n${TEXT}`);

    expect(listEdits(ctx)[0]?.source).toEqual({ path: FILE, line: 5 });
  });

  it("a third value in the file: `from` follows it and the selection is published again", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    editTextStyle(ctx, "ui.amount", "align", "left");
    ctx.link.notify.mockClear();

    // Somebody else changed the size: neither the wanted value nor the one the edit started from.
    await agentWrites(TEXT.replace("size: 105", "size: 100"));

    expect(kept("textStyle:ui.amount")?.edits).toEqual([
      { path: "size", from: 100, to: 96 },
      { path: "align", from: "center", to: "left" }
    ]);
    expect(published().at(-1)?.edits).toEqual([
      { path: "textStyle:ui.amount#size", from: 100, to: 96 },
      { path: "textStyle:ui.amount#align", from: "center", to: "left" }
    ]);
  });

  it("after `from` followed the file, typing the old value is a real edit", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    await agentWrites(TEXT.replace("size: 105", "size: 100"));

    // 105 is no longer what the file has: it is a wanted value like any other.
    editTextStyle(ctx, "ui.amount", "size", 105);
    expect(kept("textStyle:ui.amount")?.edits).toEqual([{ path: "size", from: 100, to: 105 }]);

    // And the value the file has now removes the edit.
    editTextStyle(ctx, "ui.amount", "size", 100);
    expect(ctx.state.edits.size).toBe(0);
  });

  it("a read that shows the same values publishes nothing and keeps the edits as they are", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    const before = kept("textStyle:ui.amount")?.edits;
    ctx.link.notify.mockClear();

    await agentWrites(`${TEXT}// a note\n`);

    expect(kept("textStyle:ui.amount")?.edits).toBe(before);
    expect(published()).toEqual([]);
  });

  it("a field that is no literal any more in a parsed block drops its edit", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    editTextStyle(ctx, "ui.amount", "align", "left");
    ctx.link.notify.mockClear();

    // The size is a token now: a read-only row, no field edits it.
    await agentWrites(TEXT.replace("size: 105", "size: sizes.amount"));

    const card = ctx.state.textStyle;
    expect(card?.status === "found" && card.rows.find(row => row.path === "size")).toEqual({
      path: "size",
      raw: "sizes.amount",
      value: undefined
    });
    expect(kept("textStyle:ui.amount")?.edits).toEqual([
      { path: "align", from: "center", to: "left" }
    ]);
    expect(published().at(-1)?.edits).toEqual([
      { path: "textStyle:ui.amount#align", from: "center", to: "left" }
    ]);
  });

  it("a field that left a parsed block drops its edit too", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    editTextStyle(ctx, "ui.amount", "align", "left");

    await agentWrites(TEXT.replace('    align: "center",\n', ""));

    expect(kept("textStyle:ui.amount")?.edits).toEqual([{ path: "size", from: 105, to: 96 }]);
  });

  it("the last edit dropped that way forgets the key", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    ctx.link.notify.mockClear();

    await agentWrites(TEXT.replace("size: 105", "size: sizes.amount"));

    expect(ctx.state.edits.size).toBe(0);
    expect(published().at(-1)?.edits).toBeUndefined();
    expect(published()).not.toEqual([]);
  });

  it("a block that cannot be parsed (no rows) keeps every edit as it is", async () => {
    editTextStyle(ctx, "ui.amount", "size", 96);
    editTextStyle(ctx, "ui.amount", "align", "left");
    ctx.link.notify.mockClear();

    answer(ctx, "textStyle:ui.amount", place(FILE, [2, 3, 2, 22]));
    await agentWrites("export const uiStyles = defineTextStyles({\n  amount: { size: 1 }\n});");

    expect(ctx.state.textStyle).toMatchObject({ status: "found", line: 2, rows: [] });
    expect(kept("textStyle:ui.amount")).toEqual({
      label: "textStyle ui.amount",
      source: { path: FILE, line: 2 },
      byId: false,
      edits: [
        { path: "size", from: 105, to: 96 },
        { path: "align", from: "center", to: "left" }
      ]
    });
    expect(published()).toEqual([]);
  });
});
