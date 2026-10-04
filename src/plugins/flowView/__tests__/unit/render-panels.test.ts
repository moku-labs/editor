// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, menuItems } from "../../render/ContextMenu";
import { HistoryLabels, HistoryStrip, labelLayout } from "../../render/HistoryStrip";
import { entry, PLUGIN_DIR } from "../helpers";
import { mount, mountWorkspace, prepared, settle } from "../render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("ContextMenu (D4, M5, M7, M8)", () => {
  it("lists the node items; Step is disabled unless paused and does nothing", async () => {
    const { ctx, actions, fakes } = await prepared();
    const items = menuItems(ctx, actions, {
      target: "node",
      key: "main/board>board/awaitIntent",
      outcome: undefined,
      x: 0,
      y: 0
    });
    const labels = items.map(entry => entry.label);
    expect(labels.slice(0, 3)).toEqual(["Focus", "Open code", "Open styles"]);
    expect(labels.some(label => label.includes("note"))).toBe(false);
    expect(labels).toContain("Step 1 frame");
    expect(labels).toContain("Pause game");
    const step = items.find(entry => entry.label === "Step 1 frame");
    expect(step?.disabled).toBe(true);
    step?.run();
    expect(fakes.run).not.toHaveBeenCalled();
    fakes.status = { kind: "paused", frame: 1 };
    const paused = menuItems(ctx, actions, {
      target: "node",
      key: "main/board>board/awaitIntent",
      outcome: undefined,
      x: 0,
      y: 0
    });
    expect(paused.find(entry => entry.label === "Step 1 frame")?.disabled).toBe(false);
    expect(paused.map(entry => entry.label)).toContain("Resume game");
    const sub = menuItems(ctx, actions, {
      target: "node",
      key: "main/settings",
      outcome: undefined,
      x: 0,
      y: 0
    });
    expect(sub.map(entry => entry.label)).toEqual(
      expect.arrayContaining(["Expand", "Enter settingsPopup"])
    );
  });

  it("lists outcome and canvas items; Reset layout is disabled while nothing is pinned", async () => {
    const { ctx, actions } = await prepared();
    const outcome = menuItems(ctx, actions, {
      target: "outcome",
      key: "main/board>board/merge",
      outcome: "done",
      x: 0,
      y: 0
    });
    expect(outcome.map(entry => entry.label)).toEqual(["Focus awaitIntent"]);
    const canvas = menuItems(ctx, actions, {
      target: "canvas",
      key: undefined,
      outcome: undefined,
      x: 0,
      y: 0
    });
    expect(canvas.map(entry => entry.label)).toEqual(["Fit all", "Reset layout"]);
    expect(canvas.find(entry => entry.label === "Reset layout")?.disabled).toBe(true);
    outcome[0]?.run();
    expect(ctx.state.focus.selected).toBe("main/board>board/awaitIntent");
  });

  it("opens no menu for an outcome without an edge", async () => {
    const { ctx, actions } = await prepared();
    const graph = ctx.state.data.graph;
    const edges = graph?.flows.board?.edges.merge;
    if (edges !== undefined) delete edges.done;
    actions.focus.openMenu({
      target: "outcome",
      key: "main/board>board/merge",
      outcome: "done",
      x: 10,
      y: 10
    });
    const { host, unmount } = mount(h(ContextMenu, { ctx, actions }));
    expect(host.querySelector('[data-flow="context-menu"]')).toBeNull();
    unmount();
  });

  it("renders a popover menu with the first item focused; Enter runs, ↓ moves", async () => {
    const { ctx, actions } = await prepared();
    actions.focus.openMenu({ target: "canvas", key: undefined, outcome: undefined, x: 10, y: 10 });
    const { host, unmount } = mount(h(ContextMenu, { ctx, actions }));
    const menu = host.querySelector<HTMLElement>('[data-flow="context-menu"]');
    expect(menu?.getAttribute("popover")).toBe("manual");
    expect(menu?.getAttribute("role")).toBe("menu");
    const items = menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [];
    expect(document.activeElement).toBe(items[0]);
    await settle(() => {
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(items[1]);
    expect(items[1]?.getAttribute("aria-disabled")).toBe("true");
    const fit = vi.spyOn(actions.camera, "fitAll");
    await settle(() => {
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(fit).toHaveBeenCalled();
    expect(ctx.state.focus.menu).toBeUndefined();
    unmount();
  });
});

describe("HistoryStrip (B4, M3)", () => {
  it("draws 20 dots newest first with trail and rejected marks; open rows select edges", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.data.history = [
      entry(1, "home", "play"),
      entry(2, "board/merge", "rejected", { frame: 1778, payload: { reason: "empty" } }),
      entry(3, "board/awaitIntent", "merge", { next: "board/merge" })
    ];
    const { host, unmount } = await mountWorkspace(ctx);
    const dots = host.querySelectorAll<HTMLElement>('[data-flow="history-dot"]');
    expect([...dots].map(dot => dot.dataset.index)).toEqual(["3", "2", "1"]);
    expect(dots[1]?.hasAttribute("data-rejected")).toBe(true);
    expect(dots[0]?.hasAttribute("data-trail")).toBe(true);
    await settle(() => host.querySelector<HTMLElement>('[data-action="history"]')?.click());
    expect(host.textContent).toContain("History · 3 edges · newest first");
    const rows = host.querySelectorAll<HTMLElement>('[data-flow="history-row"]');
    expect(rows[1]?.textContent).toContain("f1778");
    expect(rows[1]?.textContent).toContain("✕ rejected");
    await settle(() => rows[1]?.click());
    expect(ctx.state.focus.edge).toBe("main/board>board/merge:rejected");
    expect(actions.focus.selected()).toBe("main/board>board/merge");
    unmount();
  });

  it("puts the labels inside the canvas clip box, right-aligned, 38 px apart: never over the Inspector", () => {
    const canvasWidth = 900;
    const rects = labelLayout(
      [
        { index: 3, y: 60 },
        { index: 2, y: 70 },
        { index: 1, y: 300 }
      ],
      canvasWidth,
      260
    );
    for (const rect of rects) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(canvasWidth);
      expect(rect.x).toBeGreaterThanOrEqual(0);
    }
    expect((rects[1]?.y ?? 0) - (rects[0]?.y ?? 0)).toBeGreaterThanOrEqual(38);
    const inspector = { x: canvasWidth, y: 0, w: 320, h: 800 };
    for (const rect of rects) expect(rect.x + rect.w <= inspector.x).toBe(true);
  });

  it("the label layer is a child of the canvas and shows the newest, hovered and selected labels", async () => {
    const { ctx, actions } = await prepared();
    ctx.state.data.history = [entry(1, "home", "play"), entry(2, "board/merge", "done")];
    actions.focus.hoverHistory(1);
    const { host, unmount } = await mountWorkspace(ctx);
    const layer = host.querySelector('[data-flow="history-labels"]');
    expect(layer?.closest('[data-flow="canvas"]')).not.toBeNull();
    expect(layer?.closest('[data-flow="inspector"]')).toBeNull();
    expect(layer?.querySelectorAll("[data-label]")).toHaveLength(2);
    unmount();
    expect(HistoryLabels).toBeTypeOf("function");
    expect(HistoryStrip).toBeTypeOf("function");
  });
});

describe("styles of flowView (M6, M10, M14, R5, R7)", () => {
  it("has no backdrop-filter, no class selector, no @layer wrapper; @scope per sheet; tokens only", async () => {
    const { readdirSync } = await import("node:fs");
    const root = PLUGIN_DIR;
    const sheets = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
      file => file.endsWith(".css") && !file.includes("__tests__")
    );
    expect(sheets.length).toBe(19);
    for (const sheet of sheets) {
      const text = readFileSync(`${root}${sheet}`, "utf8");
      const code = text.replaceAll(/\/\*[\s\S]*?\*\//g, "");
      expect(code, sheet).not.toMatch(/backdrop-filter/);
      expect(code, sheet).not.toMatch(/@layer/);
      expect(code, sheet).toMatch(/@scope \(\[data-flow="[\w-]+"\]\)/);
      expect(code, sheet).not.toMatch(/(^|[\s,>+~(])\.[A-Za-z_]/m);
      expect(code.replaceAll(/--flow-[\w-]+:[^;]+;/g, ""), sheet).not.toMatch(
        /#[\da-fA-F]{3,8}\b|rgba?\(/
      );
    }
    const styles = readFileSync(`${root}inspector/StylesTab.css`, "utf8");
    expect(styles).toMatch(/min-width: 0/);
    const canvas = readFileSync(`${root}render/canvas.css`, "utf8");
    expect(canvas).toMatch(/--flow-label-min: 11px/);
    expect(canvas).toMatch(/\[data-stale\][^{]*\{[^}]*filter: saturate\(0\.2\)/);
  });

  it("the canvas clips and never scrolls: the camera origin stays the canvas box", () => {
    const canvas = readFileSync(`${PLUGIN_DIR}render/canvas.css`, "utf8");
    const rule = /\[data-flow="canvas"\]\s*\{([^}]*)\}/.exec(canvas)?.[1] ?? "";
    expect(rule).toMatch(/overflow: clip;/);
    expect(rule).not.toMatch(/overflow: hidden/);
  });
});
