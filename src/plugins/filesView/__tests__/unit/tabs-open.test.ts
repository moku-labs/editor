import { describe, expect, it, vi } from "vitest";
import {
  cancelEdit,
  closeTopmost,
  dismissConfirm,
  setBuffer,
  setEditing,
  setMode
} from "../../tabs/edit";
import { activeTab, findTab, isModified, newTab, tabInfo } from "../../tabs/model";
import { activateTab, closeTab, openTab } from "../../tabs/open";
import { createCtx, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Tabs: open appends and activates, reopen activates, line stored, close of a
// modified tab returns false and opens the popover, active moves right then
// left; edit mode, buffer, mode and the Esc closer.
// ─────────────────────────────────────────────────────────────────────────────

describe("openTab", () => {
  it("shows Files, appends a tab, activates it, reveals it and loads it", async () => {
    const ctx = createCtx();
    const listener = vi.fn();
    ctx.state.listeners.add(listener);
    await openTab(ctx, "nodes/merge.ts", {});
    expect(ctx.workspace.show).toHaveBeenCalledWith("files");
    expect(ctx.state.tabs.map(tab => tab.path)).toEqual(["nodes/merge.ts"]);
    expect(ctx.state.active).toBe("nodes/merge.ts");
    expect(ctx.state.expanded.has("nodes")).toBe(true);
    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      kind: "code",
      status: "ready",
      saved: "export const merge = 1;\n",
      buffer: "export const merge = 1;\n",
      mode: "source",
      editing: false
    });
    expect(listener).toHaveBeenCalled();
  });

  it("activates an open tab instead of adding a second one and stores the line", async () => {
    const ctx = createCtx();
    await openTab(ctx, "nodes/merge.ts", {});
    await openTab(ctx, "flows/board.ts", {});
    await openTab(ctx, "nodes/merge.ts", { line: 12 });
    expect(ctx.state.tabs.map(tab => tab.path)).toEqual(["nodes/merge.ts", "flows/board.ts"]);
    expect(ctx.state.active).toBe("nodes/merge.ts");
    expect(findTab(ctx.state, "nodes/merge.ts")?.line).toBe(12);
    expect(ctx.files.client.read).toHaveBeenCalledTimes(2);
  });

  it("re-loads an open tab whose file was missing", async () => {
    const ctx = createCtx();
    await openTab(ctx, "nodes/new.ts", {});
    expect(findTab(ctx.state, "nodes/new.ts")?.status).toBe("missing");
    ctx.files.set("nodes/new.ts", "x");
    await openTab(ctx, "nodes/new.ts", {});
    expect(findTab(ctx.state, "nodes/new.ts")?.status).toBe("ready");
  });

  it("opens markdown and series in preview, and in source with edit", async () => {
    const ctx = createCtx();
    await openTab(ctx, ".moku/notes/2026-09-24-first.md", {});
    expect(findTab(ctx.state, ".moku/notes/2026-09-24-first.md")?.mode).toBe("preview");
    await openTab(ctx, "README.md", { edit: true });
    expect(findTab(ctx.state, "README.md")).toMatchObject({ mode: "source", editing: true });
  });

  it("does not enter edit mode for an image", async () => {
    const ctx = createCtx();
    await openTab(ctx, ".moku/captures/a.png", { edit: true });
    expect(findTab(ctx.state, ".moku/captures/a.png")).toMatchObject({
      kind: "image",
      editing: false
    });
  });
});

describe("closeTab", () => {
  it("closes a clean tab and moves the active tab right, then left", async () => {
    const ctx = createCtx();
    for (const path of ["flows/main.ts", "flows/board.ts", "nodes/merge.ts"]) {
      await openTab(ctx, path, {});
    }
    activateTab(ctx, "flows/board.ts");
    expect(closeTab(ctx, "flows/board.ts", false)).toBe(true);
    expect(ctx.state.active).toBe("nodes/merge.ts");
    expect(closeTab(ctx, "nodes/merge.ts", false)).toBe(true);
    expect(ctx.state.active).toBe("flows/main.ts");
    expect(closeTab(ctx, "flows/main.ts", false)).toBe(true);
    expect(ctx.state.active).toBeUndefined();
  });

  it("keeps the active tab when another tab closes", async () => {
    const ctx = createCtx();
    await openTab(ctx, "flows/main.ts", {});
    await openTab(ctx, "flows/board.ts", {});
    expect(closeTab(ctx, "flows/main.ts", false)).toBe(true);
    expect(ctx.state.active).toBe("flows/board.ts");
  });

  it("returns false and opens the discard popover for a modified tab", async () => {
    const ctx = createCtx();
    await openTab(ctx, "nodes/merge.ts", {});
    setBuffer(ctx, "nodes/merge.ts", "changed");
    expect(closeTab(ctx, "nodes/merge.ts", false)).toBe(false);
    expect(ctx.state.confirmClose).toBe("nodes/merge.ts");
    expect(ctx.state.tabs).toHaveLength(1);
    expect(closeTab(ctx, "nodes/merge.ts", true)).toBe(true);
    expect(ctx.state.confirmClose).toBeUndefined();
    expect(ctx.state.tabs).toHaveLength(0);
  });

  it("returns false for a path that is not open", () => {
    expect(closeTab(createCtx(), "nope.ts", false)).toBe(false);
  });
});

describe("activateTab", () => {
  it("activates, reveals and revalidates an open tab; ignores unknown paths", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const ctx = createCtx();
      await openTab(ctx, "nodes/merge.ts", {});
      await openTab(ctx, "flows/board.ts", {});
      ctx.state.expanded.clear();
      vi.setSystemTime(Date.now() + 5000);
      activateTab(ctx, "nodes/merge.ts");
      expect(ctx.state.active).toBe("nodes/merge.ts");
      expect(ctx.state.expanded.has("nodes")).toBe(true);
      await settle();
      expect(ctx.files.client.read).toHaveBeenCalledTimes(3);
      activateTab(ctx, "nope.ts");
      expect(ctx.state.active).toBe("nodes/merge.ts");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("edit mode, buffer and mode", () => {
  it("enters and leaves edit mode on the active tab, keeping the buffer", async () => {
    const ctx = createCtx();
    await openTab(ctx, "nodes/merge.ts", {});
    setEditing(ctx, true);
    expect(activeTab(ctx.state)?.editing).toBe(true);
    setBuffer(ctx, "nodes/merge.ts", "next");
    setEditing(ctx, false, "nodes/merge.ts");
    const tab = findTab(ctx.state, "nodes/merge.ts");
    expect(tab?.editing).toBe(false);
    expect(tab?.buffer).toBe("next");
    expect(tab && isModified(tab)).toBe(true);
  });

  it("switches markdown and series to source when editing; images are a no-op", async () => {
    const ctx = createCtx();
    await openTab(ctx, ".moku/captures/series-2026-09-24-1015/index.json", {});
    setEditing(ctx, true);
    expect(activeTab(ctx.state)).toMatchObject({ mode: "source", editing: true });
    await openTab(ctx, ".moku/captures/a.png", {});
    setEditing(ctx, true);
    expect(activeTab(ctx.state)?.editing).toBe(false);
    setEditing(createCtx(), true);
  });

  it("sets the mode of markdown and series only", async () => {
    const ctx = createCtx();
    await openTab(ctx, ".moku/notes/2026-09-24-first.md", {});
    await openTab(ctx, "nodes/merge.ts", {});
    setMode(ctx, ".moku/notes/2026-09-24-first.md", "source");
    setMode(ctx, "nodes/merge.ts", "preview");
    expect(findTab(ctx.state, ".moku/notes/2026-09-24-first.md")?.mode).toBe("source");
    expect(findTab(ctx.state, "nodes/merge.ts")?.mode).toBe("source");
    setMode(ctx, "nope.md", "source");
    setBuffer(ctx, "nope.ts", "x");
  });

  it("cancel drops the buffer and leaves edit mode", async () => {
    const ctx = createCtx();
    await openTab(ctx, "nodes/merge.ts", { edit: true });
    setBuffer(ctx, "nodes/merge.ts", "next");
    cancelEdit(ctx, "nodes/merge.ts");
    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      editing: false,
      buffer: "export const merge = 1;\n"
    });
    cancelEdit(ctx, "nope.ts");
  });

  it("the Esc closer closes the popover first, then leaves edit mode, then does nothing", async () => {
    const ctx = createCtx();
    await openTab(ctx, "nodes/merge.ts", { edit: true });
    setBuffer(ctx, "nodes/merge.ts", "next");
    closeTab(ctx, "nodes/merge.ts", false);
    expect(closeTopmost(ctx)).toBe(true);
    expect(ctx.state.confirmClose).toBeUndefined();
    expect(activeTab(ctx.state)?.editing).toBe(true);
    expect(closeTopmost(ctx)).toBe(true);
    expect(activeTab(ctx.state)?.editing).toBe(false);
    expect(closeTopmost(ctx)).toBe(false);
  });

  it("dismissConfirm closes the popover without closing the tab", async () => {
    const ctx = createCtx();
    await openTab(ctx, "nodes/merge.ts", {});
    ctx.state.confirmClose = "nodes/merge.ts";
    dismissConfirm(ctx);
    expect(ctx.state.confirmClose).toBeUndefined();
    expect(ctx.state.tabs).toHaveLength(1);
  });
});

describe("tab model", () => {
  it("builds a fresh tab and its info", () => {
    const tab = newTab(".moku/notes/a.md");
    expect(tab).toMatchObject({
      kind: "markdown",
      mode: "preview",
      status: "loading",
      checkedAt: 0
    });
    expect(tabInfo(tab)).toEqual({
      path: ".moku/notes/a.md",
      kind: "markdown",
      modified: false,
      editing: false,
      status: "loading"
    });
  });
});
