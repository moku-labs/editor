// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { ElementTab } from "../../ui/ElementTab";
import { answer, createCtx, place, projectOn, sceneCapture, type TestCtx } from "../helpers";
import { boardScene, button, click, find, findAll, fire, type Mounted, mount, settle } from "../ui";

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
    click(button(view.root, "Pick another"));
    expect(ctx.state.picker.on).toBe(true);
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
    const values = findAll(view.root, "[data-part='style'] dd").map(value => value.textContent);
    expect(values.slice(-2)).toEqual(["top 40", "right 40 · left 40"]);
    await select({ kind: "entity", id: 1_048_628 });
    expect(view.root.textContent).toContain("No style of its own.");
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

  it("shows the reference block read-only; Copy puts its one line on the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await select({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    await settle();
    const pre = find(view.root, "pre[data-part='reference']");
    const lines = (pre.textContent ?? "").split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "@moku coinPill · row · f1841",
      "path: boardScreen/hudRow/coinPill",
      "source: src/hud/Hud.tsx:2 · style: coinPill src/hud/styles.ts:1 · texture: ui.hud-pill"
    ]);
    expect(lines).toContain(
      "layout: hudRow (row, padding 0/40/0/40, margin 40/0/0/0) < boardScreen (column, padding 0/0/0/0)"
    );
    expect(pre.getAttribute("aria-busy")).toBe("false");

    const copy = find(view.root, "button[data-action='copy-reference']");
    expect(copy.textContent).toBe("Copy");
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
