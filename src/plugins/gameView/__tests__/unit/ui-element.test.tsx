// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../../handlers";
import { stopGameView } from "../../lifecycle";
import { rebuildScene } from "../../scene/rebuild";
import { notify } from "../../state";
import { ElementTab } from "../../ui/ElementTab";
import { answer, createCtx, place, projectOn, sceneCapture, type TestCtx } from "../helpers";
import {
  blurField,
  boardCaptureStyled,
  boardScene,
  button,
  click,
  find,
  findAll,
  fire,
  type Mounted,
  mount,
  pressKey,
  sceneOf,
  settle,
  typeInto
} from "../ui";

const HUD = 'import { coinPill } from "./styles";\n<Pill key="coinPill" style={coinPill} />\n';
const STYLES = "export const coinPill = defineStyle({\n  height: 76,\n  radius: 38\n});\n";
const MANIFEST = JSON.stringify({
  version: 1,
  bundles: {
    board: {
      tier: "scene",
      mb: 1,
      files: [{ key: "board.item-wood-3", path: "wood-3.webp", width: 256, height: 256, mb: 0.1 }]
    }
  }
});

/**
 * The spawn line of the shown entity's Code section.
 *
 * @returns The line.
 */
function spawn(): Element {
  return find(view.root, "section[data-part='code'] [data-part='spawn']");
}

/** The delta of the first project state: a gap, everything is read again. */
const FIRST_STATE = { all: true, files: [], moved: [], removed: [] } as const;

let ctx: TestCtx;
let view: Mounted;

beforeEach(() => {
  ctx = createCtx({
    "src/hud/Hud.tsx": HUD,
    "src/hud/styles.ts": STYLES,
    "manifest.json": MANIFEST
  });
  ctx.link.projectValue = projectOn(
    { "style:src/hud/styles.ts#coinPill": ["src/hud/styles.ts"] },
    { manifest: "manifest.json" }
  );
  answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [2, 1, 2, 42]));
  ctx.state.scene = boardScene();
  view = mount(<ElementTab ctx={ctx} />);
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
});

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
 * The Styles section of the tab.
 *
 * @returns The section.
 */
function styles(): HTMLElement {
  return find(view.root, "section[data-part='style']");
}

/**
 * The field of a style path in the Styles section.
 *
 * @param path - The style path ("width", "padding.left").
 * @returns Its input.
 */
function field(path: string): HTMLInputElement {
  return find<HTMLInputElement>(styles(), `input[aria-label='${path}']`);
}

/**
 * The select of an enum style path in the Styles section.
 *
 * @param path - The style path ("justify", "cell.direction").
 * @returns Its select.
 */
function choice(path: string): HTMLSelectElement {
  return find<HTMLSelectElement>(styles(), `select[aria-label='${path}']`);
}

/**
 * Chooses an option of a select and commits it (the `change` a choice fires).
 *
 * @param select - The select.
 * @param value - The option chosen.
 */
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/**
 * The values a select offers, in order.
 *
 * @param select - The select.
 * @returns The value of each option.
 */
function optionsOf(select: HTMLSelectElement): string[] {
  return findAll<HTMLOptionElement>(select, "option").map(option => option.value);
}

/**
 * Selects an element and lets the tab settle.
 *
 * @param ref - The element.
 */
async function select(
  ref: { kind: "ui"; path: string } | { kind: "entity"; id: number }
): Promise<void> {
  act(() => {
    ctx.state.selected = ref;
    notify(ctx.state);
  });
  await settle();
}

describe("ElementTab", () => {
  it("empty: the Select element button turns the picker on; one line explains", () => {
    click(button(view.root, "Select element ⇧⌘C"));
    expect(ctx.state.picker.on).toBe(true);
    expect(view.root.textContent).toContain(
      "Pick an element in the game to see its place in the render tree, its bounds, texture and styles."
    );
  });

  it("filled: breadcrumb, name, type, bounds with the device, children and the actions", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    const crumbs = find(view.root, "nav[data-part='crumbs']");
    expect(crumbs.getAttribute("aria-label")).toBe("Render tree path");
    expect(findAll(crumbs, "button").map(crumb => crumb.textContent)).toEqual([
      "boardScreen",
      "hudRow"
    ]);
    expect(find(view.root, "[data-part='name']").textContent).toBe("coinPill");
    expect(find(view.root, "[data-part='type']").textContent).toBe("row");
    expect(findAll(view.root, "[data-part='bounds'] dd").map(cell => cell.textContent)).toEqual([
      "235",
      "74",
      "290",
      "76"
    ]);
    expect(find(view.root, "[data-part='device']").textContent).toBe(
      "iPhone 15 portrait · 393×852"
    );
    expect(
      findAll(view.root, "[data-part='children'] button").map(chip => chip.textContent)
    ).toEqual(["coinPillIcon", "coinPillText"]);

    click(button(view.root, "Show in render tree"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:reveal", {
      ref: { kind: "ui", path: "boardScreen/hudRow/coinPill" }
    });
  });

  it("the footer holds Copy reference, then Show in render tree; Pick another is gone (U3)", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    const footer = find(view.root, "[data-part='element'] > footer");
    const actions = findAll<HTMLButtonElement>(footer, "button");
    expect(actions.map(action => action.textContent)).toEqual([
      "Copy reference",
      "Show in render tree"
    ]);
    expect(actions.map(action => action.dataset.variant)).toEqual(["ghost", "ghost"]);
    expect(findAll(view.root, "button").map(action => action.textContent)).not.toContain(
      "Pick another"
    );
    expect(ctx.state.picker.on).toBe(false);
  });

  it("breadcrumb and children select; hovering them draws the pink box", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    const crumb = button(find(view.root, "nav[data-part='crumbs']"), "hudRow");
    fire(crumb, new PointerEvent("pointerenter"));
    expect(ctx.state.treeHover).toEqual({ kind: "ui", path: "boardScreen/hudRow" });
    fire(crumb, new PointerEvent("pointerleave"));
    expect(ctx.state.treeHover).toBeUndefined();
    click(crumb);
    expect(ctx.state.selected).toEqual({ kind: "ui", path: "boardScreen/hudRow" });
  });

  it("shows the resolved style as rows, or that the element has none", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow" });
    const rows = findAll(view.root, "[data-part='style'] dt").map(term => term.textContent);
    expect(rows).toEqual([
      "direction",
      "align",
      "justify",
      "alignSelf",
      "height",
      "margin",
      "padding"
    ]);
    // A record is one field per leaf, labelled with the leaf name (U8).
    const leaves = (row: string): (string | null)[] =>
      findAll(styles(), `[data-row='${row}'] [data-part='leaf']`).map(leaf => leaf.textContent);
    expect(leaves("margin")).toEqual(["top"]);
    expect(leaves("padding")).toEqual(["right", "left"]);
    expect(field("margin.top").value).toBe("40");
    expect(field("padding.left").value).toBe("40");
    await select({ kind: "entity", id: 1_048_628 });
    expect(view.root.textContent).toContain("No style of its own.");
  });

  it("Styles: a text node with an empty scene style shows the text style key the index knows", async () => {
    // The game sends `style: {}` for every text node; the index knows `style="ui.amount"`.
    ctx.link.files.put("src/hud/Text.tsx", '<text key="coinPillText" style="ui.amount" />');
    answer(ctx, "jsx:coinPillText", place("src/hud/Text.tsx", [1, 1, 1, 46]));
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill/coinPillText" });
    await settle();

    const styles = find(view.root, "section[data-part='style']");
    expect(find(styles, "[data-part='style-name']").textContent).toBe("Style · ui.amount");
    expect(styles.textContent).not.toContain("No style of its own.");
    expect(styles.querySelector("dl")).toBeNull();
  });

  it("Styles: an empty scene style shows the style call or the style identifier of the source", async () => {
    ctx.link.files.put("src/hud/Text.tsx", '<Label id="coinPillText" style={labelOf(3)} />');
    answer(ctx, "jsx:coinPillText", place("src/hud/Text.tsx", [1, 1, 1, 47]));
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill/coinPillText" });
    await settle();
    expect(find(view.root, "section[data-part='style'] [data-part='style-name']").textContent).toBe(
      "Style · labelOf(3)"
    );

    ctx.link.files.put("src/hud/Text.tsx", '<Label id="coinPillText" style={pillLabel} />');
    answer(ctx, "jsx:coinPillText", place("src/hud/Text.tsx", [1, 1, 1, 46]));
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill/coinPillText" });
    await settle();
    expect(find(view.root, "section[data-part='style'] [data-part='style-name']").textContent).toBe(
      "Style · pillLabel"
    );
  });

  it('Styles: an empty scene style without a style in the index keeps "No style of its own."', async () => {
    // The index does not know the key.
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill/coinPillText" });
    await settle();
    const missing = find(view.root, "section[data-part='style']");
    expect(find(missing, "p").textContent).toBe("No style of its own.");
    expect(missing.querySelector("[data-part='style-name']")).toBeNull();

    // The index knows the key, its tag has no style.
    ctx.link.files.put("src/hud/Text.tsx", '<text key="coinPillText" />');
    answer(ctx, "jsx:coinPillText", place("src/hud/Text.tsx", [1, 1, 1, 28]));
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill/coinPillText" });
    await settle();
    expect(ctx.state.found.get("coinPillText")?.kind).toBe("defined");
    const plain = find(view.root, "section[data-part='style']");
    expect(find(plain, "p").textContent).toBe("No style of its own.");
    expect(plain.querySelector("[data-part='style-name']")).toBeNull();
  });

  it("Styles: a non-empty scene style still lists its props, not the style of the index", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await settle();
    expect(ctx.state.found.get("coinPill")?.kind).toBe("ident");
    const styles = find(view.root, "section[data-part='style']");
    expect(findAll(styles, "dt").map(term => term.textContent)).toEqual([
      "width",
      "height",
      "direction",
      "align",
      "justify",
      "margin",
      "padding",
      "nineSlice"
    ]);
    expect(styles.querySelector("[data-part='style-name']")).toBeNull();
    expect(styles.textContent).not.toContain("No style of its own.");
  });

  it("entity: id, owner, component chips and the texture with its manifest data", async () => {
    await select({ kind: "entity", id: 1_048_628 });
    const entity = find(view.root, "[data-part='entity']");
    expect(entity.textContent).toContain("1048628");
    expect(entity.textContent).toContain("board.items");
    expect(findAll(entity, "[data-chip]").map(chip => chip.textContent)).toContain("Sprite");
    const texture = find(view.root, "[data-part='texture']");
    expect(texture.textContent).toContain("board.item-wood-3");
    expect(texture.textContent).toContain("256×256 · 0.25 MB · board");
  });

  it("shows the layout style card: path:line, Open in Files, the block lines and steppers", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await settle();
    const card = find(view.root, "[data-part='style-card']");
    expect(find(card, "[data-part='where']").textContent).toBe("src/hud/styles.ts:1");
    expect(findAll(card, "[data-part='line']").length).toBe(4);
    click(button(card, "Open in Files"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "src/hud/styles.ts",
      line: 1
    });

    const height = find(card, "[data-field='height']");
    click(find(height, "button[aria-label='Increase height']"));
    expect(ctx.state.styles?.pending).toEqual({ path: "height", raw: "76", next: 77 });
    expect(find(view.root, "[data-field='height'] output").textContent).toBe("77");
    expect(find(card, "[data-field='radius']").querySelector("button")).toBeNull();
  });

  it("says a key is not in the project index, and shows a refusal with Open in Files", async () => {
    await select({ kind: "ui", path: "boardScreen/orders" });
    expect(find(view.root, "[data-part='not-found']").textContent).toBe(
      "Not in the project index: jsx:orders"
    );

    ctx.link.files.put("src/hud/Row.tsx", '<Row key="hudRow" style={nowhere} />');
    answer(ctx, "jsx:hudRow", place("src/hud/Row.tsx", [1, 1, 1, 38]));
    await select({ kind: "ui", path: "boardScreen/hudRow" });
    expect(view.root.textContent).toContain("No style block named nowhere.");
    click(button(find(view.root, "[data-part='style-card']"), "Open in Files"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "src/hud/Row.tsx",
      line: 1
    });
  });

  it("says why when the project index is off", async () => {
    ctx.link.projectValue = { state: "off", reason: "typescript is not installed" };
    vi.spyOn(ctx.link.files, "find").mockRejectedValue(new Error("project index off"));
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(find(view.root, "[data-part='not-found']").textContent).toBe(
      "Project index is off: typescript is not installed"
    );
    expect(view.root.querySelector("section[data-part='code']")).toBeNull();
  });

  it("shows a style call read-only and where a key without a style is defined", async () => {
    ctx.link.files.put("src/hud/Orders.tsx", '<Board\n  id="orders"\n  style={boardOf(3)}\n/>');
    answer(ctx, "jsx:orders", place("src/hud/Orders.tsx", [1, 1, 4, 3], { line: 2 }));
    await select({ kind: "ui", path: "boardScreen/orders" });
    const card = find(view.root, "[data-part='style-card']");
    expect(find(card, "[data-part='where']").textContent).toBe("src/hud/Orders.tsx:3");
    expect(find(card, "[data-part='call']").textContent).toBe("boardOf(3)");
    expect(card.textContent).toContain("Computed by a call · read-only");
    expect(card.querySelector("[data-field]")).toBeNull();
    click(button(card, "Open in Files"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "src/hud/Orders.tsx",
      line: 3
    });

    ctx.link.files.put("src/hud/Orders.tsx", '<Board id="orders" />');
    answer(ctx, "jsx:orders", place("src/hud/Orders.tsx", [1, 1, 1, 22]));
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await select({ kind: "ui", path: "boardScreen/orders" });
    const defined = find(view.root, "[data-part='style-card']");
    expect(defined.textContent).toContain("Defined at src/hud/Orders.tsx:1");
    expect(defined.querySelector("[data-part='not-found']")).toBeNull();
    click(button(defined, "Open in Files"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "src/hud/Orders.tsx",
      line: 1
    });
  });

  it("an id prop is defined at its own line and shows the style of the element its component draws", async () => {
    // merge-game's giftReward: `amountKey="giftReward"` on <Amount>, the text is in the component.
    ctx.link.files.put(
      "features/gift/daily-gift.tsx",
      '<Amount\n  id="coinPill"\n  amountKey="coinPillText"\n/>'
    );
    ctx.link.files.put(
      "shared/views/amount.tsx",
      '<row key={props.id}>\n  <text key={props.amountKey} style="ui.amount" content={props.amount} />\n</row>'
    );
    ctx.link.files.put(
      "features/ui/text-styles.ts",
      'export const uiStyles = defineTextStyles({\n  "ui.amount": { size: 96 }\n});'
    );
    answer(
      ctx,
      "jsx:coinPillText",
      place("features/gift/daily-gift.tsx", [1, 1, 4, 3], {
        line: 3,
        key: "coinPillText",
        kind: "idProp",
        component: "Amount",
        prop: "amountKey"
      }),
      place("shared/views/amount.tsx", [2, 3, 2, 74], {
        key: "{amountKey}",
        kind: "ident",
        component: "Amount"
      })
    );
    answer(ctx, "textStyle:ui.amount", place("features/ui/text-styles.ts", [2, 3, 2, 28]));

    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill/coinPillText" });
    await settle();

    const card = find(view.root, "[data-part='style-card']");
    expect(card.textContent).toContain("Defined at features/gift/daily-gift.tsx:3");
    const [jsx, style] = findAll(view.root, "section[data-part='code'] [data-part='snippet']");
    if (jsx === undefined || style === undefined) throw new Error("two snippets");
    expect(find(jsx, "[data-part='where']").textContent).toBe("features/gift/daily-gift.tsx:1");
    expect(find(style, "[data-part='title']").textContent).toBe("Style · ui.amount");
    expect(find(style, "[data-part='where']").textContent).toBe("features/ui/text-styles.ts:2");
  });

  it("has no reference block; Copy reference in the footer puts the one line on the clipboard (U3)", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await settle();
    expect(view.root.querySelector("[data-part='reference-block']")).toBeNull();
    expect(view.root.querySelector("pre[data-part='reference']")).toBeNull();
    expect(view.root.textContent).not.toContain("Gathering the reference");
    // Nothing gathers the block for the tab any more: no read of the flow position or the history.
    expect(ctx.link.read).not.toHaveBeenCalledWith("game.history", { last: 1 });

    const copy = find(view.root, "footer button[data-action='copy-reference']");
    expect(copy.textContent).toBe("Copy reference");
    expect(copy.getAttribute("title")).toBe(
      "Write the reference card and copy its line for the chat"
    );
    click(copy);
    await settle();
    expect(String(writeText.mock.calls[0]?.at(0))).toMatch(
      /^@moku coinPill row · src\/hud\/Hud\.tsx:2 · ref .* · \.moku\/captures\/\d{4}-\d{2}-\d{2}\/coinPill-f1841\.md$/
    );
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Reference copied");
    vi.unstubAllGlobals();
  });

  it("shows the code: the element's JSX and its style block, highlighted, with Open in Files", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await settle();
    const code = find(view.root, "section[data-part='code']");
    const [jsx, style] = findAll(code, "[data-part='snippet']");
    if (jsx === undefined || style === undefined) throw new Error("two snippets");
    expect(find(jsx, "[data-part='title']").textContent).toBe("JSX");
    expect(find(jsx, "[data-part='where']").textContent).toBe("src/hud/Hud.tsx:2");
    expect(findAll(jsx, "[data-line]").map(line => line.dataset.line)).toEqual(["2"]);
    expect(findAll(jsx, "[data-token]").length).toBeGreaterThan(0);
    expect(find(style, "[data-part='title']").textContent).toBe("Style · coinPill");
    expect(find(style, "[data-part='where']").textContent).toBe("src/hud/styles.ts:1");
    expect(findAll(style, "[data-line]")).toHaveLength(4);

    click(button(jsx, "Open in Files"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "src/hud/Hud.tsx",
      line: 2
    });
  });

  it("the scroll boxes take the keyboard focus: the style block and both code snippets (F3)", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await settle();
    const block = find(view.root, "[data-part='style-card'] ol[data-part='lines']");
    expect(block.getAttribute("tabindex")).toBe("0");
    expect(block.getAttribute("aria-label")).toBe("Style block");

    const snippets = findAll(view.root, "section[data-part='code'] div[data-part='code-lines']");
    expect(snippets).toHaveLength(2);
    for (const lines of snippets) expect(lines.getAttribute("tabindex")).toBe("0");
  });

  it("shows 20 lines of a long element and the rest after Show all", async () => {
    const children = Array.from({ length: 30 }, (_, index) => `  <spacer key="s${index}" />`);
    ctx.link.files.put(
      "src/hud/Hud.tsx",
      ['<Pill key="coinPill">', ...children, "</Pill>"].join("\n")
    );
    answer(ctx, "jsx:coinPill", place("src/hud/Hud.tsx", [1, 1, 32, 8]));
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await settle();
    const jsx = find(view.root, "section[data-part='code'] [data-part='snippet']");
    expect(findAll(jsx, "[data-line]")).toHaveLength(20);
    const more = find(jsx, "button[data-action='show-all']");
    expect(more.textContent).toBe("Show all 32 lines");
    click(more);
    expect(findAll(jsx, "[data-line]")).toHaveLength(32);
    expect(jsx.querySelector("button[data-action='show-all']")).toBeNull();
  });

  it("shows an entity's projection with its definition and its components with values", async () => {
    ctx.link.files.put(
      "features/board/items.tsx",
      'export const boardItems = projection({\n  name: "board.items",\n});'
    );
    answer(ctx, "projection:board.items", place("features/board/items.tsx", [2, 3, 2, 22]));
    ctx.state.sources.entities = sceneCapture("scene-board.txt").entities;
    await select({ kind: "entity", id: 1_048_628 });
    await settle();
    const code = find(view.root, "section[data-part='code']");
    const spawn = find(code, "[data-part='spawn']");
    expect(spawn.textContent).toBe("Spawned by board.items · features/board/items.tsx:2");
    click(find(spawn, "button"));
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-file", {
      path: "features/board/items.tsx",
      line: 2
    });
    const rows = findAll(code, "[data-part='components'] > div");
    expect(rows[0]?.textContent).toBe("Layername items");
    expect(rows.map(row => find(row, "dt").textContent)).toContain("Sprite");
  });

  it("says when the index does not know the projection of an entity", async () => {
    await select({ kind: "entity", id: 1_048_628 });
    await settle();
    const spawn = find(view.root, "section[data-part='code'] [data-part='spawn']");
    expect(spawn.textContent).toBe(
      "Spawned by board.items · Not in the project index: projection:board.items"
    );
    expect(spawn.querySelector("button")).toBeNull();
  });

  it("an entity picked before the first project state shows its projection once the state arrives", async () => {
    ctx.link.projectValue = undefined;
    const lost = vi.spyOn(ctx.link.files, "find").mockRejectedValue(new Error("link lost"));
    await select({ kind: "entity", id: 1_048_628 });
    expect(spawn().textContent).toBe(
      "Spawned by board.items · Project index is off: no state from the server yet"
    );

    lost.mockRestore();
    ctx.link.files.put(
      "features/board/items.tsx",
      'export const boardItems = projection({\n  name: "board.items",\n});'
    );
    answer(ctx, "projection:board.items", place("features/board/items.tsx", [2, 3, 2, 22]));
    const state = projectOn({ "projection:board.items": ["features/board/items.tsx"] });
    ctx.link.projectValue = state;
    act(() => {
      createHandlers(ctx)["link:project"]({ state, delta: FIRST_STATE });
    });
    await settle();
    expect(spawn().textContent).toBe("Spawned by board.items · features/board/items.tsx:2");
  });

  it("a ui element picked before the first project state shows its style card once the state arrives", async () => {
    ctx.link.projectValue = undefined;
    const lost = vi.spyOn(ctx.link.files, "find").mockRejectedValue(new Error("link lost"));
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(find(view.root, "[data-part='not-found']").textContent).toBe(
      "Project index is off: no state from the server yet"
    );

    lost.mockRestore();
    const state = projectOn({ "style:src/hud/styles.ts#coinPill": ["src/hud/styles.ts"] });
    ctx.link.projectValue = state;
    act(() => {
      createHandlers(ctx)["link:project"]({ state, delta: FIRST_STATE });
    });
    await settle();
    expect(view.root.querySelector("[data-part='not-found']")).toBeNull();
    expect(ctx.state.styles?.path).toBe("src/hud/styles.ts");
  });

  it("says the index is asked while the answer is on its way", () => {
    act(() => {
      ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
      notify(ctx.state);
    });
    expect(view.root.textContent).toContain("Finding coinPill in the project index…");
  });

  it("waits for the scene; an unplaced node says so; a texture without manifest data shows the key", async () => {
    act(() => {
      ctx.state.scene = undefined;
      ctx.state.selected = { kind: "ui", path: "boardScreen" };
      notify(ctx.state);
    });
    expect(view.root.textContent).toContain("Waiting for the scene of the selected element…");

    act(() => {
      ctx.state.scene = boardScene();
      ctx.state.manifest = undefined;
      notify(ctx.state);
    });
    await select({ kind: "entity", id: 1_048_640 });
    expect(view.root.textContent).toContain("Not placed on screen.");

    ctx.link.files.put("manifest.json", "{}");
    await select({ kind: "entity", id: 1_048_629 });
    const texture = find(view.root, "[data-part='texture']").textContent ?? "";
    expect(texture).toContain("board.item-");
    expect(texture).not.toContain("MB");
  });

  it("decreases a field and highlights a crumb on focus", async () => {
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await settle();
    click(find(view.root, "button[aria-label='Decrease height']"));
    expect(ctx.state.styles?.pending?.next).toBe(75);
    const crumb = button(find(view.root, "nav[data-part='crumbs']"), "boardScreen");
    fire(crumb, new FocusEvent("focus"));
    expect(ctx.state.treeHover).toEqual({ kind: "ui", path: "boardScreen" });
    fire(crumb, new FocusEvent("blur"));
    expect(ctx.state.treeHover).toBeUndefined();
  });
});

describe("Styles fields: pending edits for the agent (U8, D-67)", () => {
  const COIN = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;

  it("a number is a number field, a string a text field, a record one field per leaf", async () => {
    await select(COIN);
    const width = field("width");
    expect(width.type).toBe("number");
    expect(width.getAttribute("step")).toBe("1");
    expect(width.value).toBe("290");
    expect(field("nineSlice").type).toBe("text");
    expect(field("nineSlice").value).toBe("ui.hud-pill");
    expect(
      findAll<HTMLInputElement>(styles(), "[data-row='padding'] input").map(input =>
        input.getAttribute("aria-label")
      )
    ).toEqual(["padding.right", "padding.left"]);
    expect(field("padding.left").type).toBe("number");
    expect(styles().querySelector("[data-edited]")).toBeNull();
    expect(styles().querySelector("[data-part='edits']")).toBeNull();
  });

  it("a boolean is a checkbox; an array and a deeper record stay read-only text", async () => {
    act(() => {
      ctx.state.scene = sceneOf(
        boardCaptureStyled("coinPill", {
          wrap: true,
          inset: ["safeArea.top", 12],
          shadow: { offset: { x: 0, y: 2 } }
        })
      );
    });
    await select(COIN);
    const wrap = field("wrap");
    expect(wrap.type).toBe("checkbox");
    expect(wrap.checked).toBe(true);
    expect(find(styles(), "[data-row='inset'] dd").textContent).toBe("safeArea.top, 12");
    expect(styles().querySelector("[data-row='inset'] input")).toBeNull();
    expect(find(styles(), "[data-row='shadow'] dd").textContent).toBe("offset x 0 · y 2");

    act(() => {
      wrap.checked = false;
      wrap.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([
      { path: "wrap", from: true, to: false }
    ]);
    expect(field("wrap").checked).toBe(false);
    expect(find(styles(), "[data-row='wrap'] s").textContent).toBe("true");
  });

  it("a committed field records the edit: the row is marked, shows the scene value struck and a reset", async () => {
    await select(COIN);
    commit(field("width"), "320");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([{ path: "width", from: 290, to: 320 }]);

    const row = find(styles(), "[data-row='width']");
    expect(row.dataset.edited).toBe("");
    expect(field("width").value).toBe("320");
    expect(find(row, "s").textContent).toBe("290");
    const reset = find(row, "button[data-action='reset-edit']");
    expect(reset.textContent).toBe("×");
    expect(reset.getAttribute("title")).toBe("Reset to 290");
    expect(styles().querySelectorAll("[data-row][data-edited]")).toHaveLength(1);

    click(reset);
    expect(ctx.state.edits.size).toBe(0);
    expect(find(styles(), "[data-row='width']").dataset.edited).toBeUndefined();
    expect(field("width").value).toBe("290");
    expect(styles().querySelector("s")).toBeNull();
  });

  it("a leaf and a text field commit the same way; typing the scene value back removes the edit", async () => {
    await select(COIN);
    commit(field("padding.left"), "90");
    commit(field("nineSlice"), "ui.hud-pill-gold");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([
      { path: "padding.left", from: 84, to: 90 },
      { path: "nineSlice", from: "ui.hud-pill", to: "ui.hud-pill-gold" }
    ]);
    const padding = find(styles(), "[data-row='padding']");
    expect(padding.dataset.edited).toBe("");
    expect(find(padding, "[data-path='padding.left']").dataset.edited).toBe("");
    expect(find(padding, "[data-path='padding.right']").dataset.edited).toBeUndefined();
    expect(find(padding, "s").textContent).toBe("84");
    expect(find(padding, "button[data-action='reset-edit']").getAttribute("title")).toBe(
      "Reset to 84"
    );

    commit(field("nineSlice"), "ui.hud-pill");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([
      { path: "padding.left", from: 84, to: 90 }
    ]);
  });

  it("an empty or non-numeric number field commits nothing and shows its value again", async () => {
    await select(COIN);
    commit(field("width"), "");
    expect(ctx.state.edits.size).toBe(0);
    expect(field("width").value).toBe("290");

    // The same on blur.
    typeInto(field("width"), "");
    blurField(field("width"));
    expect(ctx.state.edits.size).toBe(0);
    expect(field("width").value).toBe("290");

    const width = field("width");
    Object.defineProperty(width, "value", { value: "wide", writable: true, configurable: true });
    fire(width, new Event("input", { bubbles: true }));
    pressKey(width, "Enter");
    expect(ctx.state.edits.size).toBe(0);
    expect(width.value).toBe("290");
  });

  it("Esc in a field restores the shown value: the scene value, or the pending edit", async () => {
    await select(COIN);
    const abandon = (input: HTMLInputElement, typed: string): void => {
      typeInto(input, typed);
      pressKey(input, "Escape");
    };
    abandon(field("width"), "999");
    expect(field("width").value).toBe("290");
    abandon(field("nineSlice"), "ui.hud");
    expect(field("nineSlice").value).toBe("ui.hud-pill");
    expect(ctx.state.edits.size).toBe(0);

    commit(field("width"), "320");
    abandon(field("width"), "5");
    expect(field("width").value).toBe("320");

    // Another key leaves what was typed, and commits nothing.
    typeInto(field("width"), "33");
    pressKey(field("width"), "3");
    expect(field("width").value).toBe("33");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([{ path: "width", from: 290, to: 320 }]);
  });

  it("typing records no edit: a number or text field commits on Enter or blur only", async () => {
    await select(COIN);
    for (const typed of ["3", "32", "320"]) typeInto(field("width"), typed);
    typeInto(field("nineSlice"), "ui.hud-pill-gold");
    expect(ctx.state.edits.size).toBe(0);
    expect(styles().querySelector("[data-part='edits']")).toBeNull();

    // `change` commits nothing by itself: with preact/compat it is the `input` of a keystroke.
    fire(field("width"), new Event("change", { bubbles: true }));
    fire(field("nineSlice"), new Event("change", { bubbles: true }));
    expect(ctx.state.edits.size).toBe(0);
    expect(field("width").value).toBe("320");
    expect(field("nineSlice").value).toBe("ui.hud-pill-gold");
  });

  it("Enter commits what was typed, once: a blur after it commits nothing", async () => {
    await select(COIN);
    typeInto(field("width"), "320");
    pressKey(field("width"), "Enter");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([{ path: "width", from: 290, to: 320 }]);
    expect(field("width").value).toBe("320");

    // Clear drops the edit and the field shows the scene value; the blur does not bring it back.
    click(button(find(styles(), "[data-part='edits']"), "Clear"));
    expect(field("width").value).toBe("290");
    blurField(field("width"));
    expect(ctx.state.edits.size).toBe(0);
    expect(field("width").value).toBe("290");
  });

  it("Enter and the blur it causes before the next render commit once", async () => {
    await select(COIN);
    const width = field("width");
    typeInto(width, "320");
    act(() => {
      width.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(ctx.state.edits.get("coinPill")?.edits).toHaveLength(1);
      // Emptied between the two, so a second commit would show.
      ctx.state.edits.clear();
      width.dispatchEvent(new FocusEvent("blur"));
      width.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(ctx.state.edits.size).toBe(0);
  });

  it("blur commits what was typed, once; a blur without typing commits nothing", async () => {
    await select(COIN);
    blurField(field("width"));
    expect(ctx.state.edits.size).toBe(0);

    typeInto(field("nineSlice"), "ui.hud-pill-gold");
    blurField(field("nineSlice"));
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([
      { path: "nineSlice", from: "ui.hud-pill", to: "ui.hud-pill-gold" }
    ]);
    expect(field("nineSlice").value).toBe("ui.hud-pill-gold");

    click(button(find(styles(), "[data-part='edits']"), "Clear"));
    blurField(field("nineSlice"));
    expect(ctx.state.edits.size).toBe(0);
    expect(field("nineSlice").value).toBe("ui.hud-pill");
  });

  it("Esc then blur commits nothing: the field shows the scene value", async () => {
    await select(COIN);
    const width = field("width");
    typeInto(width, "999");
    pressKey(width, "Escape");
    blurField(width);
    expect(ctx.state.edits.size).toBe(0);
    expect(width.value).toBe("290");
    expect(styles().querySelector("[data-part='edits']")).toBeNull();

    // The same when the blur comes before the next render.
    typeInto(width, "999");
    act(() => {
      width.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      width.dispatchEvent(new FocusEvent("blur"));
      width.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(ctx.state.edits.size).toBe(0);
    expect(width.value).toBe("290");
  });

  it("keeps what is being typed while the game sends new scenes: a re-render does not reset the field", async () => {
    await select(COIN);
    typeInto(field("width"), "32");
    typeInto(field("nineSlice"), "ui.hud-p");

    // A live game rebuilds the scene on every heartbeat: the tab renders again under the fields.
    act(() => {
      ctx.state.scene = boardScene();
      notify(ctx.state);
    });
    expect(field("width").value).toBe("32");
    expect(field("nineSlice").value).toBe("ui.hud-p");
    expect(ctx.state.edits.size).toBe(0);

    // The commit ends the typing: the field shows the pending value from then on.
    commit(field("width"), "320");
    act(() => {
      ctx.state.scene = boardScene();
      notify(ctx.state);
    });
    expect(field("width").value).toBe("320");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([{ path: "width", from: 290, to: 320 }]);

    // Esc drops what was typed, also after a re-render.
    typeInto(field("nineSlice"), "ui.hud-pill-gold");
    pressKey(field("nineSlice"), "Escape");
    act(() => notify(ctx.state));
    expect(field("nineSlice").value).toBe("ui.hud-pill");
  });

  it("the edits bar counts the edits, copies them for the agent and clears them", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await select(COIN);
    commit(field("width"), "320");

    const bar = find(styles(), "div[data-part='edits']");
    expect(find(bar, "[data-part='count']").textContent).toBe("1 edit");
    commit(field("padding.left"), "90");
    expect(find(styles(), "[data-part='edits'] [data-part='count']").textContent).toBe("2 edits");

    const copy = find<HTMLButtonElement>(styles(), "button[data-action='copy-edits']");
    expect(copy.textContent).toBe("Copy for agent");
    expect(copy.dataset.variant).toBe("primary");
    click(copy);
    await settle();
    expect(writeText).toHaveBeenCalledWith(
      "@moku coinPill · src/hud/Hud.tsx:2\nwidth: 290 -> 320\npadding.left: 84 -> 90"
    );
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ 2 edits copied");

    const clear = button(find(styles(), "[data-part='edits']"), "Clear");
    expect(clear.dataset.variant).toBe("ghost");
    click(clear);
    expect(ctx.state.edits.size).toBe(0);
    expect(styles().querySelector("[data-part='edits']")).toBeNull();
    expect(field("width").value).toBe("290");
    vi.unstubAllGlobals();
  });

  it("the bar also shows on an element without edits of its own, and counts the elements above one", async () => {
    await select(COIN);
    commit(field("width"), "320");

    await select({ kind: "ui", path: "boardScreen/hudRow/home" });
    expect(styles().querySelector("[data-row][data-edited]")).toBeNull();
    expect(find(styles(), "[data-part='edits'] [data-part='count']").textContent).toBe("1 edit");
    commit(field("radius"), "40");
    expect(find(styles(), "[data-part='edits'] [data-part='count']").textContent).toBe(
      "2 edits · 2 elements"
    );

    // An element with no style of its own still offers the edits of the others.
    await select({ kind: "entity", id: 1_048_628 });
    expect(styles().textContent).toContain("No style of its own.");
    expect(find(styles(), "[data-part='edits'] [data-part='count']").textContent).toBe(
      "2 edits · 2 elements"
    );
  });

  it("the game does not change: an edit writes no file and runs no command (D-67)", async () => {
    await select(COIN);
    await settle();
    const writes = ctx.link.files.writes.length;
    commit(field("width"), "320");
    await settle();
    expect(ctx.link.files.writes).toHaveLength(writes);
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.workspace.reload).not.toHaveBeenCalled();
  });

  it("a scene that shows the edited value drops the edit from the row", async () => {
    await select(COIN);
    commit(field("width"), "320");
    const next = boardCaptureStyled("coinPill", { width: 320 });
    ctx.state.sources = { ui: next.ui, entities: next.entities, projections: next.projections };
    act(() => rebuildScene(ctx, 1850));

    expect(ctx.state.edits.size).toBe(0);
    expect(find(styles(), "[data-row='width']").dataset.edited).toBeUndefined();
    expect(field("width").value).toBe("320");
    expect(styles().querySelector("[data-part='edits']")).toBeNull();
  });

  it("an enum property is a select with the engine's values; a free string stays a text field", async () => {
    await select(COIN);
    const justify = choice("justify");
    expect(optionsOf(justify)).toEqual(["start", "center", "end", "between", "around", "evenly"]);
    expect(justify.value).toBe("center");
    expect(findAll(justify, "option").map(option => option.textContent)).toEqual(
      optionsOf(justify)
    );
    expect(styles().querySelector("input[aria-label='justify']")).toBeNull();
    expect(find(styles(), "[data-row='justify'] [data-part='field']").dataset.path).toBe("justify");

    // A texture key is no enum: it stays a text field.
    expect(field("nineSlice").type).toBe("text");
    expect(styles().querySelector("select[aria-label='nineSlice']")).toBeNull();
  });

  it("every enum of the engine's style is a select: direction, align, position, origin and the rest", async () => {
    const style = {
      direction: "row",
      align: "center",
      alignSelf: "stretch",
      overflow: "hidden",
      fit: "contain",
      position: "absolute",
      shape: "triangle",
      origin: "top"
    };
    act(() => {
      ctx.state.scene = sceneOf(boardCaptureStyled("coinPill", style));
    });
    await select(COIN);
    for (const [name, value] of Object.entries(style)) {
      expect(choice(name).value).toBe(value);
    }
    expect(optionsOf(choice("direction"))).toEqual(["row", "column"]);
    expect(optionsOf(choice("origin"))).toEqual(["center", "top", "topLeft"]);
  });

  it("a select commits on change: the row is marked, shows the scene value struck and a reset", async () => {
    await select(COIN);
    choose(choice("justify"), "between");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([
      { path: "justify", from: "center", to: "between" }
    ]);

    const row = find(styles(), "[data-row='justify']");
    expect(row.dataset.edited).toBe("");
    expect(find(row, "[data-part='field']").dataset.edited).toBe("");
    expect(choice("justify").value).toBe("between");
    expect(find(row, "s").textContent).toBe("center");
    const reset = find(row, "button[data-action='reset-edit']");
    expect(reset.getAttribute("title")).toBe("Reset to center");
    expect(find(styles(), "[data-part='edits'] [data-part='count']").textContent).toBe("1 edit");

    click(reset);
    expect(ctx.state.edits.size).toBe(0);
    expect(choice("justify").value).toBe("center");
    expect(find(styles(), "[data-row='justify']").dataset.edited).toBeUndefined();

    // Choosing the scene value again removes the edit, as typing it back does.
    choose(choice("justify"), "end");
    choose(choice("justify"), "center");
    expect(ctx.state.edits.size).toBe(0);
    expect(styles().querySelector("s")).toBeNull();
  });

  it("the scene value is added as an option when the table does not list it", async () => {
    act(() => {
      ctx.state.scene = sceneOf(boardCaptureStyled("coinPill", { justify: "spread" }));
    });
    await select(COIN);
    expect(optionsOf(choice("justify"))).toEqual([
      "start",
      "center",
      "end",
      "between",
      "around",
      "evenly",
      "spread"
    ]);
    expect(choice("justify").value).toBe("spread");

    // It stays an option while an edit is pending, so the reset can show it again.
    choose(choice("justify"), "start");
    expect(optionsOf(choice("justify"))).toContain("spread");
    expect(find(styles(), "[data-row='justify'] s").textContent).toBe("spread");
  });

  it("a nested record leaf with an enum name is a select too", async () => {
    act(() => {
      ctx.state.scene = sceneOf(
        boardCaptureStyled("coinPill", { cell: { direction: "row", gap: 4 } })
      );
    });
    await select(COIN);
    const direction = choice("cell.direction");
    expect(optionsOf(direction)).toEqual(["row", "column"]);
    expect(direction.value).toBe("row");
    expect(find(styles(), "[data-path='cell.direction'] [data-part='leaf']").textContent).toBe(
      "direction"
    );
    expect(field("cell.gap").type).toBe("number");

    choose(direction, "column");
    expect(ctx.state.edits.get("coinPill")?.edits).toEqual([
      { path: "cell.direction", from: "row", to: "column" }
    ]);
    expect(find(styles(), "[data-row='cell']").dataset.edited).toBe("");
  });
});
