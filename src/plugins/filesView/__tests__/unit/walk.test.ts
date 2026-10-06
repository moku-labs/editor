// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { openExternal, paletteItemOf, replacePaletteItems } from "../../tree/palette";
import { buildIndex } from "../../tree/walk";
import { createCtx, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// buildIndex: breadth-first, at most 4 lists in flight, maxFiles truncation,
// the depth cap, a failing folder skipped with a warn, a failing root, single
// flight; then the palette items and a notify.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildIndex", () => {
  it("walks breadth first and indexes files with folders first", async () => {
    const ctx = createCtx();
    await buildIndex(ctx);
    expect(ctx.files.listed.slice(0, 1)).toEqual([""]);
    expect(ctx.files.listed.indexOf(".moku")).toBeLessThan(
      ctx.files.listed.indexOf(".moku/editor")
    );
    expect(ctx.files.listed.indexOf("nodes")).toBeLessThan(
      ctx.files.listed.indexOf(".moku/captures")
    );
    const index = ctx.state.index;
    expect(index?.children.get("")).toEqual([".moku", "features", "flows", "nodes", "README.md"]);
    expect(index?.files.get("nodes/merge.ts")).toEqual({
      path: "nodes/merge.ts",
      kind: "file",
      size: 24
    });
    expect(index?.files.has("nodes")).toBe(false);
    expect(index?.truncated).toBe(false);
    expect(typeof index?.builtAt).toBe("number");
  });

  it("groups folders first while keeping the server's order inside each group", async () => {
    const ctx = createCtx({ seed: { "b.ts": "b", "a/x.ts": "x", "c.ts": "c" } });
    ctx.files.client.list.mockImplementationOnce(() =>
      Promise.resolve([
        { path: "c.ts", kind: "file", size: 1 },
        { path: "a", kind: "dir", size: 0 },
        { path: "b.ts", kind: "file", size: 1 }
      ])
    );
    await buildIndex(ctx);
    expect(ctx.state.index?.children.get("")).toEqual(["a", "c.ts", "b.ts"]);
  });

  it("keeps at most four lists in flight", async () => {
    const seed = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`dir${index}/f.ts`, "x"])
    );
    const ctx = createCtx({ seed });
    await buildIndex(ctx);
    expect(ctx.files.maxInFlight).toBeLessThanOrEqual(4);
    expect(ctx.files.maxInFlight).toBeGreaterThan(1);
    expect(ctx.state.index?.files.size).toBe(12);
  });

  it("stops adding files at maxFiles and marks the index truncated", async () => {
    const seed = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`f${index}.ts`, "x"]));
    const ctx = createCtx({ seed, config: { maxFiles: 3 } });
    await buildIndex(ctx);
    expect(ctx.state.index?.files.size).toBe(3);
    expect(ctx.state.index?.truncated).toBe(true);
    expect(ctx.state.index?.children.get("")).toHaveLength(3);
  });

  it("does not list folders deeper than the depth cap", async () => {
    const deep = Array.from({ length: 14 }, (_, index) => `d${index}`).join("/");
    const ctx = createCtx({ seed: { [`${deep}/f.ts`]: "x" } });
    await buildIndex(ctx);
    const depths = ctx.files.listed.map(dir => (dir === "" ? 0 : dir.split("/").length));
    expect(Math.max(...depths)).toBe(12);
    expect(ctx.state.index?.files.size).toBe(0);
  });

  it("skips a failing folder with a warn", async () => {
    const ctx = createCtx();
    ctx.files.failures.set(
      "list:nodes",
      wireError(-32_004, "forbidden path: nodes", { reason: "forbidden_path" })
    );
    await buildIndex(ctx);
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:list-failed", {
      dir: "nodes",
      code: -32_004
    });
    expect(ctx.state.index?.files.has("flows/main.ts")).toBe(true);
    expect(ctx.state.index?.files.has("nodes/merge.ts")).toBe(false);
  });

  it("leaves the index unchanged and logs once when the root fails", async () => {
    const ctx = createCtx();
    ctx.files.failures.set("list:", new Error("[moku-editor] link closed"));
    await buildIndex(ctx);
    expect(ctx.state.index).toBeUndefined();
    expect(ctx.state.indexing).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:list-failed", {
      dir: "",
      code: undefined
    });
    expect(ctx.workspace.paletteAdd).not.toHaveBeenCalled();
  });

  it("runs one walk at a time (single flight)", async () => {
    const ctx = createCtx();
    const first = buildIndex(ctx);
    const second = buildIndex(ctx);
    expect(second).toBe(first);
    expect(ctx.state.indexing).toBe(first);
    await first;
    expect(ctx.files.listed.filter(dir => dir === "")).toHaveLength(1);
    expect(ctx.state.indexing).toBeUndefined();
  });

  it("then replaces the palette items and notifies", async () => {
    const ctx = createCtx();
    const listener = vi.fn();
    ctx.state.listeners.add(listener);
    const previous = vi.fn();
    ctx.state.paletteRemover = previous;
    await buildIndex(ctx);
    expect(ctx.files.client.read).not.toHaveBeenCalled();
    expect(previous).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.paletteAdd).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.items.map(item => item.id)).toContain("file:nodes/merge.ts");
    expect(ctx.workspace.items).toHaveLength(ctx.state.index?.files.size ?? -1);
    expect(listener).toHaveBeenCalled();
  });
});

describe("palette items", () => {
  it("opens the file and offers Open in editor as the alternate action", async () => {
    const ctx = createCtx();
    await buildIndex(ctx);
    const item = paletteItemOf(ctx, "nodes/merge.ts");
    expect(item).toMatchObject({
      id: "file:nodes/merge.ts",
      group: "Files",
      label: "nodes/merge.ts",
      mono: true,
      keywords: "merge.ts"
    });
    item.run();
    await settle();
    expect(ctx.workspace.show).toHaveBeenCalledWith("files");
    expect(ctx.state.active).toBe("nodes/merge.ts");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(item.alt?.label).toBe("Open in editor");
    item.alt?.run();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("omits the alternate action without boot data", () => {
    const ctx = createCtx();
    ctx.link.bootValue = undefined;
    expect(paletteItemOf(ctx, "nodes/merge.ts").alt).toBeUndefined();
  });

  it("adds nothing before the first index and replaces the previous items", () => {
    const ctx = createCtx();
    replacePaletteItems(ctx);
    expect(ctx.workspace.paletteAdd).not.toHaveBeenCalled();
  });

  it("logs a failing open from the palette", async () => {
    const ctx = createCtx();
    ctx.workspace.show.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    paletteItemOf(ctx, "nodes/merge.ts").run();
    await settle();
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:open-failed", {
      path: "nodes/merge.ts",
      message: "boom"
    });
  });

  it("openExternal clicks a detached link with the url", () => {
    const hrefs: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      hrefs.push(this.href);
    });
    openExternal("vscode://file/Users/moku/game/nodes/merge.ts:1");
    expect(hrefs).toEqual(["vscode://file/Users/moku/game/nodes/merge.ts:1"]);
  });
});
