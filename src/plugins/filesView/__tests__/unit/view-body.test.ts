// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilesViewApi } from "../../api";
import { findTab } from "../../tabs/model";
import { openTab } from "../../tabs/open";
import type { FilesViewApi, OpenTab } from "../../types";
import { CodeEditor } from "../../view/CodeEditor";
import { CodeView } from "../../view/CodeView";
import { ImagePreview } from "../../view/ImagePreview";
import { JsonBar } from "../../view/JsonBar";
import { MarkdownPreview } from "../../view/MarkdownPreview";
import { SeriesCard } from "../../view/SeriesCard";
import { createCtx, settle, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The file body: code lines with the shared highlighter, the current line,
// colour off for large files, windowing; the editor; previews for markdown,
// json, series and images.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let api: FilesViewApi;
let root: HTMLElement;

beforeEach(() => {
  ctx = createCtx();
  api = createFilesViewApi(ctx);
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  act(() => {
    render(undefined, root);
  });
  root.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Opens a file and returns its tab.
 *
 * @param path - The path.
 * @returns The tab.
 */
async function opened(path: string): Promise<OpenTab> {
  await openTab(ctx, path, {});
  const tab = findTab(ctx.state, path);
  if (!tab) throw new Error("no tab");
  return tab;
}

describe("CodeView", () => {
  it("renders numbered lines with span[data-token] from the shared highlighter", () => {
    act(() => {
      render(
        h(CodeView, {
          path: "nodes/merge.ts",
          text: "const a = 1;\n// note",
          lang: "script",
          line: 2,
          maxHighlightChars: 1000
        }),
        root
      );
    });
    const lines = root.querySelectorAll("[data-line]");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.querySelector('span[data-token="keyword"]')?.textContent).toBe("const");
    expect(lines[1]?.querySelector('span[data-token="comment"]')).not.toBeNull();
    expect(lines[0]?.querySelector("[data-gutter]")?.textContent).toBe("1");
    expect(lines[1]?.hasAttribute("data-line-current")).toBe(true);
    expect(lines[0]?.hasAttribute("data-line-current")).toBe(false);
  });

  it("turns colour off above maxHighlightChars", () => {
    act(() => {
      render(
        h(CodeView, {
          path: "a.ts",
          text: "const a = 1;",
          lang: "script",
          line: undefined,
          maxHighlightChars: 5
        }),
        root
      );
    });
    expect(root.querySelector("[data-token]")).toBeNull();
    expect(root.textContent).toContain("Large file · colours off");
    expect(root.querySelector("[data-line]")?.textContent).toBe("1const a = 1;");
  });

  it("renders a window of lines with spacers above WINDOW_LINES and follows the scroll", () => {
    const text = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`).join("\n");
    act(() => {
      render(
        h(CodeView, {
          path: "big.ts",
          text,
          lang: "plain",
          line: 1500,
          maxHighlightChars: 10_000_000
        }),
        root
      );
    });
    const view = root.querySelector<HTMLElement>('[data-part="code-view"]');
    const count = root.querySelectorAll("[data-line]").length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(3000);
    expect(root.querySelectorAll("[data-spacer]").length).toBeGreaterThan(0);
    expect(root.querySelector('[data-line="1500"]')?.hasAttribute("data-line-current")).toBe(true);
    act(() => {
      if (view) view.scrollTop = 0;
      view?.dispatchEvent(new Event("scroll"));
    });
    expect(root.querySelector('[data-line="1"]')).not.toBeNull();
  });
});

describe("CodeEditor", () => {
  it("stacks a textarea over the highlighted layer and writes the buffer on input", async () => {
    // happy-dom has no reflecting `spellcheck` property; browsers do (Preact sets the property).
    Object.defineProperty(HTMLTextAreaElement.prototype, "spellcheck", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return this.getAttribute("spellcheck") !== "false";
      },
      set(this: HTMLTextAreaElement, value: boolean) {
        this.setAttribute("spellcheck", String(value));
      }
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tab = await opened("nodes/merge.ts");
    act(() => {
      render(h(CodeEditor, { api, tab }), root);
    });
    const area = root.querySelector("textarea");
    expect(area?.getAttribute("wrap")).toBe("off");
    expect(area?.getAttribute("spellcheck")).toBe("false");
    expect(area?.getAttribute("autocapitalize")).toBe("off");
    expect(area?.getAttribute("autocomplete")).toBe("off");
    expect(area?.value).toBe("export const merge = 1;\n");
    expect(root.querySelector('[data-editor-layer] span[data-token="keyword"]')).not.toBeNull();
    expect(root.textContent).toContain("⌘S saves · Esc stops editing");
    act(() => {
      if (area) area.value = "let b = 2;";
      area?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(tab.buffer).toBe("let b = 2;");
    act(() => {
      render(h(CodeEditor, { api, tab }), root);
    });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(root.querySelector("[data-editor-layer]")?.textContent).toContain("let b = 2;");
    Reflect.deleteProperty(HTMLTextAreaElement.prototype, "spellcheck");
  });

  it("inserts two spaces on Tab", async () => {
    const tab = await opened("nodes/merge.ts");
    act(() => {
      render(h(CodeEditor, { api, tab }), root);
    });
    const area = root.querySelector("textarea");
    area?.setSelectionRange(0, 0);
    act(() => {
      area?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
      );
    });
    expect(tab.buffer).toBe("  export const merge = 1;\n");
    act(() => {
      area?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true
        })
      );
      area?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true })
      );
    });
    expect(tab.buffer).toBe("  export const merge = 1;\n");
  });

  it("has no colour above EDIT_COLOUR_LINES", async () => {
    const tab = await opened("nodes/merge.ts");
    tab.buffer = "x\n".repeat(5001);
    act(() => {
      render(h(CodeEditor, { api, tab }), root);
    });
    expect(root.textContent).toContain("Colours off while editing large files");
    expect(root.querySelector("[data-editor-layer] [data-token]")).toBeNull();
  });
});

describe("previews", () => {
  it("renders a note's front matter and body; capture links open the capture", async () => {
    const tab = await opened(".moku/notes/2026-09-24-first.md");
    act(() => {
      render(h(MarkdownPreview, { ctx, api, tab }), root);
    });
    expect(root.querySelector("dl dt")?.textContent).toBe("title");
    expect(root.querySelector("h1")?.textContent).toBe("Heading");
    expect(root.querySelector("em")?.textContent).toBe("text");
    act(() => {
      root.querySelector<HTMLButtonElement>("dd button")?.click();
    });
    await act(async () => {
      await settle();
    });
    expect(api.active()).toBe(".moku/captures/a.png");
  });

  it("logs a capture link that fails to open", async () => {
    const tab = await opened(".moku/notes/2026-09-24-first.md");
    act(() => {
      render(h(MarkdownPreview, { ctx, api, tab }), root);
    });
    ctx.workspace.show.mockImplementationOnce(() => {
      throw new Error("nope");
    });
    act(() => {
      root.querySelector<HTMLButtonElement>("dd button")?.click();
    });
    await act(async () => {
      await settle();
    });
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:open-failed", {
      path: ".moku/captures/a.png",
      message: "nope"
    });
  });

  it("shows the invalid JSON bar only for text that does not parse", () => {
    act(() => {
      render(h(JsonBar, { text: '{ "a": 1 }' }), root);
    });
    expect(root.textContent).toBe("");
    act(() => {
      render(h(JsonBar, { text: "{ nope" }), root);
    });
    expect(root.textContent).toMatch(/^Invalid JSON · /);
  });

  it("summarises a series and opens its contact sheet through workspace:open-sheet", async () => {
    const path = ".moku/captures/series-2026-09-24-1015/index.json";
    const tab = await opened(path);
    act(() => {
      render(h(SeriesCard, { ctx, tab }), root);
    });
    expect(root.textContent).toContain(
      "Series · merge burst · 2 shots · 3 s at 250 ms · from frame 1841"
    );
    expect(root.querySelector("[data-tag]")?.textContent).toBe("1 marked as bug");
    act(() => {
      [...root.querySelectorAll("button")]
        .find(item => item.textContent === "Open contact sheet")
        ?.click();
    });
    expect(ctx.emit).toHaveBeenCalledWith("workspace:open-sheet", { index: path });
  });

  it("says when a series index cannot be read", async () => {
    const path = ".moku/captures/series-2026-09-24-1015/index.json";
    ctx.files.set(path, "{ broken");
    const tab = await opened(path);
    act(() => {
      render(h(SeriesCard, { ctx, tab }), root);
    });
    expect(root.textContent).toBe("Not a series index · showing the source");
  });

  it("shows an image on a checkerboard with a caption and toggles fit and 100 %", async () => {
    ctx.state.index = {
      files: new Map([
        [".moku/captures/a.png", { path: ".moku/captures/a.png", kind: "file", size: 20_480 }]
      ]),
      children: new Map(),
      builtAt: 1,
      truncated: false
    };
    const tab = await opened(".moku/captures/a.png");
    act(() => {
      render(h(ImagePreview, { ctx, tab }), root);
    });
    const image = root.querySelector("img");
    expect(image?.getAttribute("alt")).toBe(".moku/captures/a.png");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(root.querySelector("figcaption")?.textContent).toBe("20 KB · .moku/captures/a.png");
    Object.defineProperty(image, "naturalWidth", { value: 390 });
    Object.defineProperty(image, "naturalHeight", { value: 844 });
    act(() => {
      image?.dispatchEvent(new Event("load"));
    });
    expect(root.querySelector("figcaption")?.textContent).toBe(
      "390×844 · 20 KB · .moku/captures/a.png"
    );
    const figure = root.querySelector("figure");
    expect(figure?.dataset.fit).toBe("fit");
    act(() => {
      root.querySelector("button")?.click();
    });
    expect(figure?.dataset.fit).toBe("actual");
  });

  it("estimates the size of an image that is not in the index", async () => {
    const tab = await opened(".moku/captures/a.png");
    act(() => {
      render(h(ImagePreview, { ctx, tab }), root);
    });
    expect(root.querySelector("figcaption")?.textContent).toBe("1 KB · .moku/captures/a.png");
  });
});
