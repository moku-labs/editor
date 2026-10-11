// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementRef, SceneSnapshot } from "../../../panels/shared/scene";
import type { Json } from "../../../registry/protocol";
import { isObject } from "../../capture/shot";
import { onProjectChange } from "../../handlers";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { ElementTab } from "../../ui/ElementTab";
import { answer, createCtx, place, projectOn, type TestCtx } from "../helpers";
import {
  blurField,
  boardCaptureWith,
  boardScene,
  button,
  click,
  find,
  findAll,
  type Mounted,
  mount,
  pressKey,
  sceneOf,
  settle,
  typeInto
} from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The Text style section of the Element tab (D-73, addendum 4): a text node
// with a text style key shows the fields of the key's block. A number and a
// quoted string are fields like the Styles rows; anything else is read-only.
// An edit is a pending edit of the style key: every text node with the key
// shows it, the edits bar counts it and the agent text has its own block.
// ─────────────────────────────────────────────────────────────────────────────

const AMOUNT = { kind: "ui", path: "boardScreen/hudRow/coinPill/coinPillText" } as const;
const ENERGY = { kind: "ui", path: "boardScreen/hudRow/energyPill/energyPillText" } as const;
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
  "  }",
  "});",
  ""
].join("\n");

let ctx: TestCtx;
let view: Mounted;

/**
 * Sets the text style key of the raw ui node with a key, anywhere under a node.
 *
 * @param node - A raw `game.ui` node.
 * @param key - The ui key.
 * @param textStyle - The text style key.
 */
function setTextStyle(node: Json, key: string, textStyle: string): void {
  if (!isObject(node)) return;
  if (node.key === key) node.textStyle = textStyle;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) setTextStyle(child, key, textStyle);
}

/**
 * The board with both pill texts given the same text style key, as an engine ≥ 0.14.11 sends it.
 *
 * @returns The scene.
 */
function sceneWithTextStyles(): SceneSnapshot {
  const capture = boardCaptureWith("coinPillText", node => {
    node.textStyle = "ui.amount";
  });
  setTextStyle(capture.ui, "energyPillText", "ui.amount");
  return sceneOf(capture);
}

beforeEach(() => {
  ctx = createCtx({ [FILE]: TEXT });
  ctx.link.projectValue = projectOn({ "textStyle:ui.amount": [FILE] });
  answer(ctx, "textStyle:ui.amount", place(FILE, [3, 3, 10, 4]));
  ctx.state.scene = sceneWithTextStyles();
  view = mount(<ElementTab ctx={ctx} />);
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/**
 * Selects an element and lets the tab settle.
 *
 * @param ref - The element.
 */
async function select(ref: ElementRef): Promise<void> {
  act(() => {
    ctx.state.selected = ref;
    notify(ctx.state);
  });
  await settle();
}

/**
 * The Text style section of the tab.
 *
 * @returns The section.
 */
function section(): HTMLElement {
  return find(view.root, "section[data-part='text-style']");
}

/**
 * The field of a text style path.
 *
 * @param path - The field path ("size", "shadow.dy").
 * @returns Its input.
 */
function field(path: string): HTMLInputElement {
  return find<HTMLInputElement>(section(), `input[aria-label='${path}']`);
}

/**
 * The row of a text style path.
 *
 * @param path - The field path.
 * @returns The row.
 */
function row(path: string): HTMLElement {
  return find(section(), `[data-row='${path}']`);
}

/**
 * Types a value into a field and commits it with Enter.
 *
 * @param input - The field.
 * @param value - The text typed.
 */
function commit(input: HTMLInputElement, value: string): void {
  typeInto(input, value);
  pressKey(input, "Enter");
}

/**
 * The count of the edits bar.
 *
 * @returns Its text, undefined while there is no bar.
 */
function barCount(): string | null | undefined {
  return view.root.querySelector("[data-part='edits'] [data-part='count']")?.textContent;
}

describe("Text style section", () => {
  it("a text node with a text style key shows the section: title, where, Open in Files, a row per field", async () => {
    await select(AMOUNT);

    expect(section().getAttribute("aria-label")).toBe("Text style ui.amount");
    expect(find(section(), "h4").textContent).toBe("Text style · ui.amount");
    expect(find(section(), "[data-part='where']").textContent).toBe(`${FILE}:3`);
    click(button(section(), "Open in Files"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", { path: FILE, line: 3 });

    expect(findAll(section(), "dt").map(term => term.textContent)).toEqual([
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

  it("a number is a number field and a quoted string a text field, like the Styles rows", async () => {
    await select(AMOUNT);

    expect(field("size").type).toBe("number");
    expect(field("size").step).toBe("1");
    expect(field("size").value).toBe("105");
    expect(field("shadow.dy").value).toBe("6");
    expect(field("shadow.alpha").value).toBe("0.55");
    expect(field("align").type).toBe("text");
    expect(field("align").value).toBe("center");
    // `align` of a text style is not the layout enum: a text field, no select.
    expect(section().querySelector("select")).toBeNull();
  });

  it("any other value is read-only text: an identifier, a token, a boolean", async () => {
    await select(AMOUNT);

    for (const [path, text] of [
      ["font", "font"],
      ["fill", "colors.cream"],
      ["digits", "true"],
      ["shadow.color", "creamShade"]
    ] as const) {
      expect(row(path).querySelector("input")).toBeNull();
      expect(find(row(path), "dd").textContent).toBe(text);
    }
  });

  it("sits in the Styles section, above the edits bar, under the Style line", async () => {
    await select(AMOUNT);

    const styles = find(view.root, "section[data-part='style']");
    expect(styles.contains(section())).toBe(true);
    expect(find(styles, "[data-part='style-name']").textContent).toBe("Style · ui.amount");
    commit(field("size"), "96");
    const bar = find(styles, "[data-part='edits']");
    expect(section().compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("an older engine sends no text style key: no section", async () => {
    act(() => {
      ctx.state.scene = boardScene();
    });
    await select(AMOUNT);

    expect(view.root.querySelector("section[data-part='text-style']")).toBeNull();
    expect(find(view.root, "section[data-part='style']").textContent).toContain(
      "No style of its own."
    );
  });

  it("a node of another type has no section", async () => {
    await select(COIN);
    expect(view.root.querySelector("section[data-part='text-style']")).toBeNull();
  });

  it("the index does not know the key: the not-found line, no fields", async () => {
    ctx.link.files.answers.delete("textStyle:ui.amount");
    await select(AMOUNT);

    expect(find(section(), "h4").textContent).toBe("Text style · ui.amount");
    expect(find(section(), "[data-part='not-found']").textContent).toBe(
      "Not in the project index: textStyle:ui.amount"
    );
    expect(section().querySelector("dl")).toBeNull();
    expect(section().querySelector("input")).toBeNull();
  });

  it("says why when the project index is off", async () => {
    ctx.link.files.answers.delete("textStyle:ui.amount");
    ctx.link.projectValue = { state: "off", reason: "typescript is not installed" };
    await select(AMOUNT);

    expect(find(section(), "[data-part='not-found']").textContent).toBe(
      "Project index is off: typescript is not installed"
    );
  });
});

describe("Text style fields: pending edits of the style key", () => {
  it("a committed field records the edit of the key: marked, the file value struck, a reset", async () => {
    await select(AMOUNT);
    commit(field("size"), "96");

    expect(ctx.state.edits.get("textStyle:ui.amount")).toEqual({
      label: "textStyle ui.amount",
      source: { path: FILE, line: 3 },
      byId: false,
      edits: [{ path: "size", from: 105, to: 96 }]
    });
    expect(row("size").dataset.edited).toBe("");
    expect(field("size").value).toBe("96");
    expect(find(row("size"), "s").textContent).toBe("105");
    const reset = find<HTMLButtonElement>(row("size"), "button[data-action='reset-edit']");
    expect(reset.title).toBe("Reset to 105");

    click(reset);
    expect(ctx.state.edits.size).toBe(0);
    expect(row("size").dataset.edited).toBeUndefined();
    expect(field("size").value).toBe("105");
  });

  it("a text field commits on blur; a nested number by its dotted path; Esc restores", async () => {
    await select(AMOUNT);
    typeInto(field("align"), "left");
    expect(ctx.state.edits.size).toBe(0);
    blurField(field("align"));
    commit(field("shadow.dy"), "8");

    expect(ctx.state.edits.get("textStyle:ui.amount")?.edits).toEqual([
      { path: "align", from: "center", to: "left" },
      { path: "shadow.dy", from: 6, to: 8 }
    ]);

    typeInto(field("size"), "12");
    pressKey(field("size"), "Escape");
    blurField(field("size"));
    expect(field("size").value).toBe("105");
    expect(ctx.state.edits.get("textStyle:ui.amount")?.edits).toHaveLength(2);
  });

  it("the edits bar counts it and Copy for agent writes the block of the style key", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await select(AMOUNT);
    expect(barCount()).toBeUndefined();
    commit(field("size"), "96");
    expect(barCount()).toBe("1 edit");

    click(find(view.root, "button[data-action='copy-edits']"));
    await settle();
    expect(writeText).toHaveBeenCalledWith(
      `@moku textStyle ui.amount · ${FILE}:3\nsize: 105 -> 96`
    );
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ 1 edit copied");
  });

  it("every text node with the key shows the same pending edit", async () => {
    await select(AMOUNT);
    commit(field("size"), "96");

    await select(ENERGY);
    expect(find(view.root, "[data-part='name']").textContent).toBe("energyPillText");
    expect(row("size").dataset.edited).toBe("");
    expect(field("size").value).toBe("96");
    expect(find(row("size"), "s").textContent).toBe("105");
    expect(barCount()).toBe("1 edit");
  });

  it("the game does not change: an edit writes no file and runs no command", async () => {
    await select(AMOUNT);
    const writes = ctx.link.files.writes.length;
    commit(field("size"), "96");
    await settle();

    expect(ctx.link.files.writes).toHaveLength(writes);
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.workspace.reload).not.toHaveBeenCalled();
  });

  it("the block read again with the wanted value drops the edit from the row", async () => {
    await select(AMOUNT);
    commit(field("size"), "96");

    ctx.link.files.put(FILE, TEXT.replace("size: 105", "size: 96"));
    const state = projectOn({ "textStyle:ui.amount": [FILE] }, { revision: "r2" });
    ctx.link.projectValue = state;
    act(() => {
      onProjectChange(ctx)({
        state,
        delta: { all: false, files: [FILE], moved: [], removed: [] }
      });
    });
    await settle();

    expect(ctx.state.edits.size).toBe(0);
    expect(row("size").dataset.edited).toBeUndefined();
    expect(field("size").value).toBe("96");
    expect(barCount()).toBeUndefined();
  });
});

describe("a text style key the JSX lookup did not give (a key built in code)", () => {
  it("the Style line names the key of the node when the index does not know the element", async () => {
    await select(AMOUNT);
    expect(find(view.root, "section[data-part='style'] [data-part='style-name']").textContent).toBe(
      "Style · ui.amount"
    );
  });

  it("the Style line names the key of the node instead of the call that builds it", async () => {
    ctx.link.files.put(
      "src/hud/Text.tsx",
      '<text key="coinPillText" style={toneStyle("ui", tone)} />'
    );
    answer(ctx, "jsx:coinPillText", place("src/hud/Text.tsx", [1, 1, 1, 58]));
    await select(AMOUNT);
    await settle();

    expect(ctx.state.found.get("coinPillText")?.kind).toBe("call");
    expect(find(view.root, "section[data-part='style'] [data-part='style-name']").textContent).toBe(
      "Style · ui.amount"
    );
  });

  it("the Code section shows the block of the node's key when the element is not in the index", async () => {
    await select(AMOUNT);
    await settle();

    const snippets = findAll(view.root, "section[data-part='code'] [data-part='snippet']");
    expect(snippets).toHaveLength(1);
    const [style] = snippets;
    if (style === undefined) throw new Error("one snippet");
    expect(find(style, "[data-part='title']").textContent).toBe("Style · ui.amount");
    expect(find(style, "[data-part='where']").textContent).toBe(`${FILE}:3`);
  });

  it("the Code section shows the JSX and the block of the node's key when the style is a call", async () => {
    ctx.link.files.put(
      "src/hud/Text.tsx",
      '<text key="coinPillText" style={toneStyle("ui", tone)} />'
    );
    answer(ctx, "jsx:coinPillText", place("src/hud/Text.tsx", [1, 1, 1, 58]));
    await select(AMOUNT);
    await settle();

    const [jsx, style] = findAll(view.root, "section[data-part='code'] [data-part='snippet']");
    if (jsx === undefined || style === undefined) throw new Error("two snippets");
    expect(find(jsx, "[data-part='title']").textContent).toBe("JSX");
    expect(find(style, "[data-part='title']").textContent).toBe("Style · ui.amount");
    expect(find(style, "[data-part='where']").textContent).toBe(`${FILE}:3`);
  });
});
