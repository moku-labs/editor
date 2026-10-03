// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- Preact renders null for "nothing" */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelTools } from "../../../panels/types";
import type { LinkStatus } from "../../../registry/protocol";
import { createRenderViewApi } from "../../api";
import { createHandlers } from "../../handlers";
import { startRenderView } from "../../lifecycle";
import { createRenderPanel } from "../../panel";
import type { RenderViewApi } from "../../types";
import {
  ASSETS,
  createCtx,
  deliverBoard,
  EFFECTS,
  type FrameQueue,
  flush,
  manifestOf,
  RENDER,
  serveManifest,
  stubFrames,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The Render workspace in happy-dom: title, six tiles, the C9 render tree with
// hover box, keyboard and "Inspect in Game", the textures card (chips, sort,
// hover), bundles, pools and the release log.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let frames: FrameQueue;
let api: RenderViewApi;
let host: HTMLElement;

function toolsOf(status: LinkStatus): PanelTools<Readonly<Record<string, string>>> {
  return {
    run: {},
    status,
    channel: ctx.link.api,
    files: ctx.link.api.files,
    workspace: ctx.workspace.api
  };
}

function show(status?: LinkStatus): void {
  const panel = createRenderPanel(ctx);
  act(() => {
    render(panel.view({}, toolsOf(status ?? { kind: "live", frame: 1841 })), host);
  });
}

function q<T extends Element = HTMLElement>(selector: string): T | null {
  return host.querySelector<T>(selector);
}

function all(selector: string): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(selector)];
}

function rowOf(id: string): HTMLElement | null {
  return q(`[role='treeitem'][data-id='${id}']`);
}

function box(): HTMLElement | null {
  return ctx.workspace.overlay.querySelector<HTMLElement>("[data-render='box'] [data-box]");
}

function fire(element: Element | null, type: string, init: KeyboardEventInit = {}): void {
  act(() => {
    element?.dispatchEvent(
      type.startsWith("key")
        ? new KeyboardEvent(type, { bubbles: true, ...init })
        : new Event(type, { bubbles: type !== "pointerenter" && type !== "pointerleave" })
    );
  });
}

async function fill(): Promise<void> {
  serveManifest(ctx);
  startRenderView(ctx);
  createHandlers(ctx)["workspace:changed"]({ ws: "render" });
  await deliverBoard(ctx, frames);
  ctx.link.send("game.render", RENDER);
  ctx.link.send("game.assets", ASSETS);
  await flush();
}

beforeEach(() => {
  ctx = createCtx();
  frames = stubFrames();
  api = createRenderViewApi(ctx);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

describe("RenderWorkspace", () => {
  it("shows the title, six tiles and empty cards before any value", () => {
    show();

    expect(q("h1")?.textContent).toBe("Render · game.render · frame —");
    expect(all("[data-render='tiles'] [data-tile]")).toHaveLength(6);
    expect(q("[data-tile='draws']")?.textContent).toContain("Waiting for game.render");
    expect(q("[data-tile='heap']")?.getAttribute("aria-label")).toBe("JS heap: not reported");
    expect(q("[data-render='tree']")?.textContent).toContain("Waiting for the scene");
  });

  it("re-renders on every notify with the tiles, the tree and the cards", async () => {
    show();
    await fill();

    expect(q("h1")?.textContent).toBe("Render · game.render · frame 1841");
    expect(q("[data-tile='fps']")?.textContent).toContain("last 1 sample · low 60");
    expect(q("[data-tile='fps'] svg polyline")).not.toBeNull();
    expect(q("[data-tile='draws']")?.getAttribute("aria-label")).toBe(
      "Draw calls: not counted in a production build"
    );
    expect(q("[data-tile='draws']")?.dataset.absent).toBe("");
    expect(q("[data-render='tree'] header")?.textContent).toContain(
      "104 nodes · 24 with textures · 33 entities"
    );
    expect(q("[data-render='bundles']")?.textContent).toContain("Budget 192 MB · used 6 MB");
    expect(q("[data-render='pools']")?.textContent).toContain("All pools · 24 pooled · 180 in use");
    expect(q("[data-render='releases']")?.textContent).toContain("No bundle released");
  });

  it("shows the effects line and the render passes on game 0.0.3, the old texts before", async () => {
    show();
    await fill();

    expect(q("[data-tile='scene'] [data-note]")?.textContent).toBe(
      "Particles and filters are not reported (follow-up F-R1)"
    );
    expect(q("[data-tile='draws']")?.textContent).toContain("Not counted in a production build");

    ctx.link.attach(manifestOf(["game.render", "game.assets", "game.effects"]));
    await flush();
    act(() => {
      ctx.link.send("game.effects", EFFECTS);
      ctx.link.send("game.render", { ...(RENDER as object), renderPasses: 1, drawCalls: 14 });
    });

    expect(q("[data-tile='scene'] [data-note]")?.textContent).toBe(
      "18 particles · 1 emitters · 24 filters"
    );
    expect(q("[data-tile='draws'] [data-value]")?.textContent).toBe("14per frame");
    expect(q("[data-tile='draws'] [data-sub]")?.textContent).toBe("1 render pass");
    expect(q("[data-tile='draws']")?.hasAttribute("data-absent")).toBe(false);
  });

  it("marks stale data and lists the release log", async () => {
    await fill();
    ctx.link.current = { kind: "live", frame: 1900 };
    ctx.link.send("game.render", RENDER);
    ctx.link.send("game.assets", {
      textureMb: 4,
      budgetMb: 192,
      bundles: [{ name: "board", tier: "scene", mb: 4, lastUsed: 1 }]
    });
    show({ kind: "silent", since: 1, lastFrame: 1900 });

    expect(q("[data-render='workspace']")?.dataset.stale).toBe("");
    expect(q("[data-render='releases'] li")?.textContent).toBe("≈f1900 · ui · 2 MB freed");
  });
});

describe("render tree card", () => {
  it("expands, collapses, hovers and selects rows", async () => {
    await fill();
    show();

    expect(rowOf("ui:boardScreen")?.getAttribute("aria-expanded")).toBe("true");
    act(() => q<HTMLButtonElement>("[data-action='expand-all']")?.click());
    expect(rowOf("entity:3145728")).not.toBeNull();
    act(() => q<HTMLButtonElement>("[data-action='collapse-all']")?.click());
    expect(all("[role='treeitem']").map(row => row.dataset.id)).toEqual([
      "ui:boardScreen",
      "entity:1048640"
    ]);

    act(() => rowOf("ui:boardScreen")?.querySelector<HTMLElement>("[data-twisty]")?.click());
    const slot = rowOf("ui:boardScreen/boardSlot");
    fire(slot, "pointerenter");
    expect(box()?.style.width).toBe("970px");
    fire(slot, "pointerleave");
    expect(box()).toBeNull();
    fire(slot, "focus");
    expect(box()?.style.height).toBe("970px");
    fire(slot, "blur");
    expect(box()).toBeNull();

    act(() => slot?.click());
    expect(rowOf("ui:boardScreen/boardSlot")?.getAttribute("aria-selected")).toBe("true");
    expect(q("[data-detail]")?.textContent).toContain("55 · 801 · 970×970");
  });

  it("moves with the keyboard: ↓ ↑ → ← and Enter toggles the detail", async () => {
    await fill();
    show();
    const tree = q("[role='tree']");
    act(() => rowOf("ui:boardScreen")?.click());
    expect(q("[data-detail]")).not.toBeNull();

    fire(tree, "keydown", { key: "Enter" });
    expect(q("[data-detail]")).toBeNull();
    fire(tree, "keydown", { key: "ArrowDown" });
    expect(ctx.state.tree.selected).toBe("ui:boardScreen/boardBackground");
    fire(tree, "keydown", { key: "ArrowUp" });
    expect(ctx.state.tree.selected).toBe("ui:boardScreen");
    fire(tree, "keydown", { key: "ArrowLeft" });
    expect(ctx.state.tree.open.has("ui:boardScreen")).toBe(false);
    fire(tree, "keydown", { key: "ArrowRight" });
    expect(ctx.state.tree.open.has("ui:boardScreen")).toBe(true);
    fire(tree, "keydown", { key: "ArrowUp" });
    expect(ctx.state.tree.selected).toBe("ui:boardScreen");
    fire(tree, "keydown", { key: "Home" });
    expect(ctx.state.tree.selected).toBe("ui:boardScreen");
  });

  it("emits workspace:inspect once with the selected row's ref", async () => {
    await fill();
    api.reveal({ kind: "entity", id: 3_145_728 });
    show();

    act(() => q<HTMLButtonElement>("[data-action='inspect']")?.click());

    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:inspect", {
      ref: { kind: "entity", id: 3_145_728 }
    });
    expect(q("[data-detail]")?.textContent).toContain(
      "3145728 · Layer, Transform, Order, Parent, NineSlice"
    );
  });

  it("offers Show game while the preview is hidden", async () => {
    await fill();
    ctx.workspace.previewVisible = false;
    show();

    act(() => q<HTMLButtonElement>("[data-action='show-game']")?.click());

    expect(ctx.workspace.setPreview).toHaveBeenCalledWith("render", { visible: true });
  });
});

describe("textures card", () => {
  it("filters with the chips, sorts with the headers, hovers rows", async () => {
    await fill();
    show();

    expect(all("[data-render='textures'] tbody tr").map(row => row.dataset.key)).toEqual([
      "ui.hud-pill",
      "board.board-tray",
      "board.cell"
    ]);
    expect(q("[data-render='textures']")?.textContent).toContain("GPU MB = w × h × 4");
    expect(all("[role='radiogroup'] [role='radio']").map(chip => chip.textContent)).toEqual([
      "All 3",
      "board 2",
      "ui 1"
    ]);

    act(() => all("[role='radio']")[1]?.click());
    expect(all("tbody tr").map(row => row.dataset.key)).toEqual(["board.board-tray", "board.cell"]);

    act(() => q<HTMLButtonElement>("th[data-sort='key'] button")?.click());
    expect(q("th[data-sort='key']")?.getAttribute("aria-sort")).toBe("ascending");
    expect(all("tbody tr").map(row => row.dataset.key)).toEqual(["board.board-tray", "board.cell"]);

    const cell = q("tbody tr[data-key='board.cell']");
    expect(cell?.dataset.use).toBe("in-use");
    fire(cell, "pointerenter");
    expect(box()?.style.left).toBe("404px");
    fire(cell, "pointerleave");
    expect(box()).toBeNull();
    fire(cell, "focus");
    expect(ctx.state.table.hover).toBe("board.cell");
    fire(cell, "blur");
    expect(ctx.state.table.hover).toBeUndefined();
  });

  it("names a texture that is not on screen and the missing manifest", async () => {
    await fill();
    show();
    act(() => q<HTMLButtonElement>("th[data-sort='use'] button")?.click());
    const pill = q("tbody tr[data-key='ui.hud-pill']");
    expect(pill?.title).toBe("");

    ctx.state.catalogue = null;
    show();
    expect(q("[data-render='textures']")?.textContent).toContain(
      "No asset manifest found at manifest.json, public/manifest.json, web/manifest.json"
    );
  });

  it("titles a row whose texture no scene node draws", async () => {
    await fill();
    const scene = ctx.state.scene;
    if (scene === undefined) throw new Error("no scene");
    ctx.state.scene = { ...scene, nodes: new Map() };
    show();

    const tray = q("tbody tr[data-key='board.board-tray']");
    expect(tray?.title).toBe("not on screen");
    fire(tray, "pointerenter");
    expect(box()).toBeNull();
  });
});
