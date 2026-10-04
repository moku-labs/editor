// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { createFilesViewApi } from "../../api";
import { createFilesPanel } from "../../panel";
import { findTab } from "../../tabs/model";
import type { FilesViewApi } from "../../types";
import { FilesView } from "../../view/FilesView";
import { createCtx, settle, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The Files view: tree roles and keys, tabs with the modified dot and the
// discard popover, the file bar and the conflict bar, Used-by chips, empty
// texts, no class attribute anywhere.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let api: FilesViewApi;
let root: HTMLElement;
let status: LinkStatus;

beforeEach(() => {
  ctx = createCtx();
  api = createFilesViewApi(ctx);
  status = { kind: "live", frame: 1 };
  root = document.createElement("div");
  root.dataset.panel = "files";
  document.body.append(root);
});

afterEach(() => {
  act(() => {
    render(undefined, root);
  });
  root.remove();
  vi.restoreAllMocks();
});

/**
 * Renders the view.
 */
function mount(): void {
  act(() => {
    render(h(FilesView, { ctx, api, status }), root);
  });
}

/**
 * Lets promises, timers and renders run.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await settle();
  });
}

/**
 * The element of a selector, or a failing test.
 *
 * @param selector - CSS selector.
 * @returns The element.
 */
function get<T extends Element = HTMLElement>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

/**
 * Buttons by text.
 *
 * @param text - Exact text.
 * @returns The button.
 */
function button(text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find(item => item.textContent === text);
  if (!found) throw new Error(`missing button ${text}`);
  return found;
}

/**
 * Presses a key on an element.
 *
 * @param element - The target.
 * @param key - The key.
 */
function press(element: Element, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/**
 * The tree rows.
 *
 * @returns Row elements.
 */
function rows(): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

/**
 * A tree row by path.
 *
 * @param path - The row's path.
 * @returns The row.
 */
function row(path: string): HTMLElement {
  return get(`[role="treeitem"][data-path="${path}"]`);
}

describe("empty states", () => {
  it("shows the loading text, then the failure with Retry, then the empty editor text", async () => {
    ctx.files.failures.set("list:", new Error("[moku-editor] link closed"));
    mount();
    expect(root.textContent).toContain(
      "Pick a file in the tree, or press ⌘K and type a file name."
    );
    act(() => {
      api.refresh().catch(() => undefined);
    });
    expect(root.textContent).toContain("Loading the file list…");
    await flush();
    expect(root.textContent).toContain("The file list is not available · Retry");
    ctx.files.failures.clear();
    act(() => {
      button("Retry").click();
    });
    await flush();
    expect(rows().length).toBeGreaterThan(0);
  });
});

describe("tree", () => {
  beforeEach(async () => {
    mount();
    await act(async () => {
      await api.refresh();
    });
  });

  it("has tree roles, a header with the file count and a refresh button", () => {
    expect(get('[role="tree"]').getAttribute("aria-label")).toBe("Project files");
    expect(get('[data-part="tree"]').textContent).toContain("Project · 10 files");
    expect(get('button[aria-label="Refresh the file list"]').textContent).toBe("↻");
    expect(rows().map(item => item.dataset.path)).toEqual([
      ".moku",
      "features",
      "flows",
      "nodes",
      "README.md"
    ]);
    expect(row("flows").getAttribute("aria-expanded")).toBe("false");
    expect(row("flows").getAttribute("aria-level")).toBe("1");
    expect(row("README.md").hasAttribute("aria-expanded")).toBe(false);
    expect(rows().filter(item => item.tabIndex === 0)).toHaveLength(1);
  });

  it("refreshes from the header button", async () => {
    act(() => {
      get('button[aria-label="Refresh the file list"]').click();
    });
    await flush();
    expect(ctx.files.listed.filter(dir => dir === "")).toHaveLength(2);
  });

  it("moves with the arrow keys, opens folders with → and closes them with ←", async () => {
    row(".moku").focus();
    press(row(".moku"), "ArrowDown");
    expect(document.activeElement).toBe(row("features"));
    press(row("features"), "ArrowDown");
    press(row("flows"), "ArrowRight");
    expect(row("flows").getAttribute("aria-expanded")).toBe("true");
    press(row("flows"), "ArrowRight");
    expect(document.activeElement).toBe(row("flows/board.ts"));
    expect(row("flows/board.ts").getAttribute("aria-level")).toBe("2");
    press(row("flows/board.ts"), "ArrowLeft");
    expect(document.activeElement).toBe(row("flows"));
    press(row("flows"), "ArrowLeft");
    expect(row("flows").getAttribute("aria-expanded")).toBe("false");
    press(row("flows"), "End");
    expect(document.activeElement).toBe(row("README.md"));
    press(row("README.md"), "Home");
    expect(document.activeElement).toBe(row(".moku"));
    press(row(".moku"), "ArrowUp");
    expect(document.activeElement).toBe(row(".moku"));
    press(row(".moku"), "ArrowLeft");
    press(row("README.md"), "ArrowRight");
  });

  it("opens a file with Enter and with a click, and marks it selected", async () => {
    press(row("README.md"), "Enter");
    await flush();
    expect(api.active()).toBe("README.md");
    expect(row("README.md").getAttribute("aria-selected")).toBe("true");
    act(() => {
      row("nodes").click();
    });
    act(() => {
      row("nodes/merge.ts").click();
    });
    await flush();
    expect(api.active()).toBe("nodes/merge.ts");
    press(row("nodes"), "Enter");
    expect(root.querySelector('[data-path="nodes/merge.ts"]')).toBeNull();
    press(row("nodes"), " ");
    expect(row("nodes").getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the empty captures note and a truncated count", () => {
    act(() => {
      const index = ctx.state.index;
      if (!index) return;
      ctx.state.index = {
        ...index,
        truncated: true,
        children: new Map(index.children).set(".moku/captures", [])
      };
      ctx.state.expanded.add(".moku");
      ctx.state.expanded.add(".moku/captures");
      for (const fn of ctx.state.listeners) fn();
    });
    expect(root.textContent).toContain("No captures yet · camera in Game");
    expect(get('[data-part="tree"]').textContent).toContain("Project · 10+ files");
  });
});

/**
 * Gives the Files view container a measured width (happy-dom lays nothing out).
 *
 * @param width - The width in px.
 */
function containerWidth(width: number): void {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.dataset.part === "files-view" ? ({ width } as DOMRect) : measure.call(this);
  });
}

describe("tree side panel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("docks the tree to the start edge in the files.tree SidePanel, 272 px within 200..480", () => {
    mount();
    const aside = get('aside[data-side-panel="files.tree"]');
    expect(aside.dataset.side).toBe("start");
    expect(aside.dataset.state).toBe("expanded");
    expect(aside.style.getPropertyValue("--side-panel-w")).toBe("272px");
    expect(aside.querySelector('[data-part="tree"]')).not.toBeNull();
    const handle = get('aside[data-side-panel="files.tree"] [role="separator"]');
    expect(handle.getAttribute("aria-valuemin")).toBe("200");
    expect(handle.getAttribute("aria-valuemax")).toBe("480");
    expect(root.querySelector('[data-action="reopen-files.tree"]')).toBeNull();
  });

  it("closes to a reopen button that shows the tree again", () => {
    mount();
    act(() => {
      get('aside[data-side-panel="files.tree"] [data-action="close"]').click();
    });
    expect(root.querySelector("[data-side-panel]")).toBeNull();
    const reopen = get<HTMLButtonElement>('[data-action="reopen-files.tree"]');
    expect(reopen.title).toBe(String.raw`Show Files tree (\)`);
    act(() => {
      reopen.click();
    });
    expect(get('aside[data-side-panel="files.tree"]').dataset.state).toBe("expanded");
    expect(root.querySelector('[data-action="reopen-files.tree"]')).toBeNull();
  });

  it("floats over the editor as a drawer below a 600 px container and starts collapsed", () => {
    containerWidth(480);
    mount();
    const aside = get('aside[data-side-panel="files.tree"]');
    expect(aside.dataset.overlay).toBe("");
    expect(aside.dataset.state).toBe("collapsed");
    expect(get("[data-files-editor]")).not.toBeNull();
  });

  it("shuts the drawer when a file is picked in it, and keeps it for a folder", async () => {
    containerWidth(480);
    mount();
    await act(async () => {
      await api.refresh();
    });
    act(() => {
      get('[data-action="expand"]').click();
    });
    expect(get('aside[data-side-panel="files.tree"]').dataset.state).toBe("expanded");
    act(() => {
      row("flows").click();
    });
    expect(get('aside[data-side-panel="files.tree"]').dataset.state).toBe("expanded");
    act(() => {
      row("README.md").click();
    });
    await flush();
    expect(get('aside[data-side-panel="files.tree"]').dataset.state).toBe("collapsed");
    expect(api.active()).toBe("README.md");
  });
});

describe("tabs", () => {
  beforeEach(async () => {
    mount();
    await act(async () => {
      await api.refresh();
      await api.open("nodes/merge.ts");
      await api.open("flows/board.ts");
    });
  });

  it("lists open files with the active one selected", () => {
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map(tab => tab.textContent)).toEqual(["merge.ts", "board.ts"]);
    expect(tabs.map(tab => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(tabs[0]?.getAttribute("title")).toBe("nodes/merge.ts");
    act(() => {
      tabs[0]?.click();
    });
    expect(api.active()).toBe("nodes/merge.ts");
  });

  it("moves between tabs with ← and →", () => {
    press(get('[role="tab"][aria-selected="true"]'), "ArrowLeft");
    expect(api.active()).toBe("nodes/merge.ts");
    press(get('[role="tab"][aria-selected="true"]'), "ArrowRight");
    expect(api.active()).toBe("flows/board.ts");
    press(get('[role="tab"][aria-selected="true"]'), "ArrowRight");
    expect(api.active()).toBe("flows/board.ts");
  });

  it("shows the discard popover in the top layer where the browser supports it", () => {
    const shown = new Set<HTMLElement>();
    Object.assign(HTMLElement.prototype, {
      showPopover(this: HTMLElement) {
        shown.add(this);
      },
      hidePopover() {}
    });
    vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (
      this: HTMLElement,
      selector: string
    ) {
      return selector === ":popover-open" && shown.has(this);
    });
    try {
      act(() => {
        api.setBuffer("nodes/merge.ts", "changed");
      });
      act(() => {
        api.close("nodes/merge.ts");
      });
      expect([...shown].map(element => element.textContent)).toEqual([
        "Discard changes to merge.ts?DiscardKeep"
      ]);
      act(() => {
        api.close("nodes/merge.ts");
      });
      expect(shown.size).toBe(1);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
      Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
    }
  });

  it("shows the modified dot and asks before discarding", async () => {
    act(() => {
      api.setBuffer("nodes/merge.ts", "changed");
    });
    expect(root.querySelectorAll("[data-modified]")).toHaveLength(1);
    act(() => {
      get('button[aria-label="Close merge.ts · modified"]').click();
    });
    expect(root.textContent).toContain("Discard changes to merge.ts?");
    act(() => {
      button("Keep").click();
    });
    expect(root.textContent).not.toContain("Discard changes to merge.ts?");
    act(() => {
      get('button[aria-label="Close merge.ts · modified"]').click();
    });
    act(() => {
      button("Discard").click();
    });
    expect(api.tabs().map(tab => tab.path)).toEqual(["flows/board.ts"]);
  });

  it("closes a clean tab with its close button and with a middle click", () => {
    act(() => {
      get('[role="tab"][title="flows/board.ts"]').dispatchEvent(
        new MouseEvent("auxclick", { button: 1, bubbles: true })
      );
    });
    expect(api.tabs().map(tab => tab.path)).toEqual(["nodes/merge.ts"]);
    act(() => {
      get('[role="tab"]').dispatchEvent(new MouseEvent("mousedown", { button: 1, bubbles: true }));
      get('[role="tab"]').dispatchEvent(new MouseEvent("auxclick", { button: 2, bubbles: true }));
    });
    expect(api.tabs()).toHaveLength(1);
    act(() => {
      get('button[aria-label="Close merge.ts"]').click();
    });
    expect(api.tabs()).toHaveLength(0);
  });
});

describe("file bar", () => {
  beforeEach(async () => {
    mount();
    await act(async () => {
      await api.refresh();
      await api.open("nodes/merge.ts", { line: 1 });
    });
  });

  it("shows the crumb, Open in editor and Edit here", () => {
    expect(get("[data-crumb]").textContent).toBe("nodes/merge.ts");
    const link = get<HTMLAnchorElement>("a[data-open-editor]");
    expect(link.getAttribute("href")).toBe("vscode://file/Users/moku/game/nodes/merge.ts:1");
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Opened in your editor", "nodes/merge.ts");
    expect(button("Edit here").dataset.variant).toBe("ghost");
  });

  it("reveals and focuses a folder from the crumb", async () => {
    act(() => {
      ctx.state.expanded.clear();
      button("nodes").click();
    });
    await flush();
    expect(ctx.state.expanded.has("nodes")).toBe(false);
    expect(document.activeElement).toBe(row("nodes"));
  });

  it("hides Open in editor without boot data", async () => {
    ctx.link.bootValue = undefined;
    act(() => {
      api.setBuffer("nodes/merge.ts", "export const merge = 1;\n");
    });
    expect(root.querySelector("a[data-open-editor]")).toBeNull();
  });

  it("edits, saves and cancels", async () => {
    act(() => {
      button("Edit here").click();
    });
    expect(findTab(ctx.state, "nodes/merge.ts")?.editing).toBe(true);
    expect(button("Save ⌘S").disabled).toBe(true);
    act(() => {
      api.setBuffer("nodes/merge.ts", "export const merge = 3;\n");
    });
    expect(button("Save ⌘S").disabled).toBe(false);
    await act(async () => {
      button("Save ⌘S").click();
      await settle();
    });
    expect(ctx.files.contents.get("nodes/merge.ts")).toBe("export const merge = 3;\n");
    act(() => {
      api.setBuffer("nodes/merge.ts", "dropped");
    });
    act(() => {
      button("Cancel").click();
    });
    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      editing: false,
      buffer: "export const merge = 3;\n"
    });
  });

  it("shows Saving… and the save note in the status line", async () => {
    act(() => {
      const tab = findTab(ctx.state, "nodes/merge.ts");
      if (tab) tab.status = "saving";
      api.setBuffer("nodes/merge.ts", "x");
    });
    expect(get("[data-save-status]").textContent).toBe("Saving…");
    act(() => {
      const tab = findTab(ctx.state, "nodes/merge.ts");
      if (tab) {
        tab.status = "ready";
        tab.message = "✓ No changes";
      }
      api.setBuffer("nodes/merge.ts", "x");
    });
    expect(get("[data-save-status]").textContent).toBe("✓ No changes");
  });

  it("shows the conflict bar with Reload and Overwrite", async () => {
    act(() => {
      api.edit(true);
      api.setBuffer("nodes/merge.ts", "mine");
    });
    ctx.files.set("nodes/merge.ts", "theirs");
    await act(async () => {
      await api.save();
    });
    const bar = get('[role="alert"][data-conflict]');
    expect(bar.textContent).toBe("The file changed on disk · Reload / Overwrite");
    await act(async () => {
      button("Overwrite").click();
      await settle();
    });
    expect(ctx.files.contents.get("nodes/merge.ts")).toBe("mine");
    expect(root.querySelector("[data-conflict]")).toBeNull();
    act(() => {
      api.setBuffer("nodes/merge.ts", "mine again");
    });
    ctx.files.set("nodes/merge.ts", "theirs again");
    await act(async () => {
      await api.save();
    });
    await act(async () => {
      button("Reload").click();
      await settle();
    });
    expect(findTab(ctx.state, "nodes/merge.ts")?.buffer).toBe("theirs again");
  });

  it("switches markdown between preview and source", async () => {
    await act(async () => {
      await api.open(".moku/notes/2026-09-24-first.md");
    });
    const source = get('[data-segmented] [role="radio"]:last-child');
    expect(get('[data-segmented] [aria-checked="true"]').textContent).toBe("Preview");
    act(() => {
      source.click();
    });
    expect(findTab(ctx.state, ".moku/notes/2026-09-24-first.md")?.mode).toBe("source");
    act(() => {
      get('[data-segmented] [role="radio"]:first-child').click();
    });
    expect(findTab(ctx.state, ".moku/notes/2026-09-24-first.md")?.mode).toBe("preview");
  });
});

describe("used by", () => {
  it("shows chips that emit workspace:select-node without showing a workspace", async () => {
    ctx.state.graph = ctx.link.graph;
    mount();
    await act(async () => {
      await api.refresh();
      await api.open("nodes/merge.ts");
    });
    ctx.workspace.show.mockClear();
    const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-chip]")];
    expect(chips.map(chip => chip.textContent)).toEqual(["board/merge"]);
    act(() => {
      chips[0]?.click();
    });
    expect(ctx.emit).toHaveBeenCalledWith("workspace:select-node", { id: "board/merge" });
    expect(ctx.workspace.show).not.toHaveBeenCalled();

    await act(async () => {
      await api.open("flows/board.ts");
    });
    act(() => {
      button("flow board").click();
    });
    expect(ctx.emit).toHaveBeenCalledWith("workspace:select-node", { id: "board/awaitIntent" });
  });

  it("says why there are no chips, and hides itself under .moku/", async () => {
    mount();
    await act(async () => {
      await api.refresh();
      await api.open("nodes/merge.ts");
    });
    expect(get('[data-part="used-by"]').textContent).toBe("Used by · connect a game to see nodes");
    act(() => {
      ctx.state.graph = ctx.link.graph;
      api.setBuffer("nodes/merge.ts", "export const merge = 1;\n");
      ctx.state.usedBy = new Map();
      api.setBuffer("nodes/merge.ts", "export const merge = 1;\n");
    });
    expect(get('[data-part="used-by"]').textContent).toBe("Used by · no node or flow");
    await act(async () => {
      await api.open(".moku/editor/files.json");
    });
    expect(root.querySelector('[data-part="used-by"]')).toBeNull();
  });
});

describe("body states", () => {
  it("shows a missing file with Close tab, and a too large file with Open in editor", async () => {
    ctx.files.failures.set(
      "read:big.ts",
      new (class extends Error {
        code = -32_000;
      })("[moku-editor] file too large: big.ts")
    );
    mount();
    await act(async () => {
      await api.open("gone.ts");
    });
    expect(root.textContent).toContain("The file is gone from disk.");
    act(() => {
      button("Close tab").click();
    });
    expect(api.tabs()).toHaveLength(0);
    await act(async () => {
      await api.open("big.ts");
    });
    expect(root.textContent).toContain("File too large to open here (over 2 MB)");
    expect(get('[data-body-state="error"] a').getAttribute("href")).toBe(
      "vscode://file/Users/moku/game/big.ts:1"
    );
  });

  it("shows the loading line while a file loads", async () => {
    mount();
    act(() => {
      api.open("nodes/merge.ts").catch(() => undefined);
    });
    expect(get('[data-body-state="loading"]').textContent).toBe("Loading…");
    await flush();
  });
});

describe("hygiene", () => {
  it("renders no class attribute and never sets innerHTML", async () => {
    const setter = vi.spyOn(Element.prototype, "innerHTML", "set");
    try {
      ctx.state.graph = ctx.link.graph;
      mount();
      await act(async () => {
        await api.refresh();
        await api.open(".moku/notes/2026-09-24-first.md");
        await api.open(".moku/captures/series-2026-09-24-1015/index.json");
        await api.open(".moku/captures/a.png");
        await api.open("nodes/merge.ts", { edit: true });
      });
      for (const path of api.tabs().map(tab => tab.path)) {
        act(() => api.activate(path));
        expect(root.querySelector("[class]")).toBeNull();
      }
      expect(setter).not.toHaveBeenCalled();
    } finally {
      setter.mockRestore();
    }
  });

  it("the panel view renders the Files view", () => {
    const panel = createFilesPanel(ctx);
    act(() => {
      render(panel.view({}, { status } as Parameters<typeof panel.view>[1]), root);
    });
    expect(root.querySelector('[data-part="files-view"]')).not.toBeNull();
  });
});
