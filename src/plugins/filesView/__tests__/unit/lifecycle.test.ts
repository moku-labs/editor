// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sidePanelState } from "../../../panels/shared/side-panel";
import { initFilesView, startFilesView, stopFilesView } from "../../lifecycle";
import { createFilesPanel } from "../../panel";
import { setBuffer, setEditing } from "../../tabs/edit";
import { openTab } from "../../tabs/open";
import { createCtx, MANIFEST, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// onInit (panel, ⌘S, the fileEdit Esc layer), onStart (manifest listener,
// index build, beforeunload guard) and onStop (every remover).
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFilesPanel", () => {
  it("defines the Files panel with no game sources", () => {
    const panel = createFilesPanel(createCtx());
    expect(panel).toMatchObject({ id: "files", title: "Files", workspace: "files", sources: {} });
    expect(typeof panel.view).toBe("function");
  });
});

describe("initFilesView", () => {
  it("registers the panel, binds ⌘S and the fileEdit Esc layer, with no I/O", () => {
    const ctx = createCtx();
    initFilesView(ctx);
    expect(ctx.register).toHaveBeenCalledTimes(1);
    expect(ctx.register.mock.calls[0]?.[0]).toMatchObject({ id: "files" });
    expect(ctx.workspace.bindings).toHaveLength(2);
    expect(ctx.workspace.bindings[0]).toMatchObject({
      keys: "mod+s",
      label: "Save file",
      workspace: "files",
      inInputs: true
    });
    expect(ctx.workspace.escapes.map(entry => entry.layer)).toEqual(["fileEdit"]);
    expect(ctx.state.removers).toHaveLength(4);
    expect(ctx.files.client.list).not.toHaveBeenCalled();
    expect(ctx.files.client.read).not.toHaveBeenCalled();
  });

  it(String.raw`binds \ to the tree panel and adds the Show Files tree palette item`, () => {
    localStorage.clear();
    const ctx = createCtx();
    initFilesView(ctx);
    const toggle = ctx.workspace.bindings.find(binding => binding.keys === "\\");
    expect(toggle).toMatchObject({
      label: "Collapse or expand the Files tree",
      workspace: "files"
    });
    expect(toggle?.inInputs).toBeUndefined();
    toggle?.run(new KeyboardEvent("keydown", { key: "\\" }));
    expect(sidePanelState("files.tree").collapsed).toBe(true);

    const item = ctx.workspace.items.find(entry => entry.label === "Show Files tree");
    expect(item).toMatchObject({ id: "files:show-tree", group: "Commands" });
    item?.run();
    expect(sidePanelState("files.tree").collapsed).toBe(false);
    expect(ctx.workspace.show).toHaveBeenCalledWith("files");
    localStorage.clear();
  });

  it("⌘S applies only while the active tab is editing and saves it", async () => {
    const ctx = createCtx();
    initFilesView(ctx);
    const binding = ctx.workspace.bindings[0];
    expect(binding?.when?.()).toBe(false);
    await openTab(ctx, "README.md", {});
    expect(binding?.when?.()).toBe(false);
    setEditing(ctx, true);
    expect(binding?.when?.()).toBe(true);
    setBuffer(ctx, "README.md", "# Game 2\n");
    binding?.run(new KeyboardEvent("keydown", { key: "s", metaKey: true }));
    await settle();
    expect(ctx.files.contents.get("README.md")).toBe("# Game 2\n");
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Saved", "README.md");
  });

  it("the Esc layer leaves edit mode and reports whether it did something", async () => {
    const ctx = createCtx();
    initFilesView(ctx);
    const close = ctx.workspace.escapes[0]?.close;
    expect(close?.()).toBe(false);
    await openTab(ctx, "README.md", { edit: true });
    expect(close?.()).toBe(true);
    expect(ctx.state.tabs[0]?.editing).toBe(false);
  });

  it("the Esc layer does nothing while another workspace is shown", async () => {
    const ctx = createCtx();
    initFilesView(ctx);
    await openTab(ctx, "README.md", { edit: true });
    vi.spyOn(ctx.workspace.api, "active").mockReturnValue("flow");
    expect(ctx.workspace.escapes[0]?.close()).toBe(false);
    expect(ctx.state.tabs[0]?.editing).toBe(true);
  });
});

describe("startFilesView", () => {
  it("loads the graph on every manifest and clears it without one", async () => {
    const ctx = createCtx();
    startFilesView(ctx);
    ctx.link.attach(MANIFEST);
    await settle();
    expect(ctx.state.graph).toEqual(ctx.link.graph);
    ctx.link.attach(undefined);
    await settle();
    expect(ctx.state.graph).toBeUndefined();
  });

  it("starts the index build without awaiting it", async () => {
    const ctx = createCtx();
    startFilesView(ctx);
    expect(ctx.state.indexing).toBeInstanceOf(Promise);
    expect(ctx.state.index).toBeUndefined();
    await ctx.state.indexing;
    expect(ctx.state.index?.files.size).toBeGreaterThan(0);
  });

  // Regression (e2e): in the browser onStart runs before the socket opens; a walk then failed
  // at once with -32002 and warned filesView:list-failed on every boot.
  it("defers the index build while the link connects or is lost", () => {
    for (const statusValue of [
      { kind: "connecting" } as const,
      { kind: "lost", reason: "closed", lastFrame: 0, retryInMs: 1000 } as const
    ]) {
      const ctx = createCtx();
      ctx.link.statusValue = statusValue;
      startFilesView(ctx);
      expect(ctx.state.indexing).toBeUndefined();
      expect(ctx.files.listed).toEqual([]);
      stopFilesView({ state: ctx.state });
    }
  });

  it("asks before leaving only while a tab is modified", async () => {
    const ctx = createCtx();
    startFilesView(ctx);
    await openTab(ctx, "README.md", {});
    const clean = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    setBuffer(ctx, "README.md", "dirty");
    const dirty = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    stopFilesView({ state: ctx.state });
  });
});

describe("stopFilesView", () => {
  it("runs every remover and the palette remover and clears the listeners", async () => {
    const ctx = createCtx();
    const remove = vi.spyOn(globalThis, "removeEventListener");
    initFilesView(ctx);
    startFilesView(ctx);
    await ctx.state.indexing;
    // The Show Files tree item (onInit), then the file items (index build).
    expect(ctx.workspace.paletteRemovers).toHaveLength(2);
    ctx.state.listeners.add(() => {});
    stopFilesView({ state: ctx.state });
    for (const remover of ctx.workspace.keyRemovers) expect(remover).toHaveBeenCalledTimes(1);
    for (const remover of ctx.workspace.paletteRemovers) expect(remover).toHaveBeenCalledTimes(1);
    expect(ctx.link.listeners.size).toBe(0);
    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(ctx.state.removers).toEqual([]);
    expect(ctx.state.paletteRemover).toBeUndefined();
    expect(ctx.state.listeners.size).toBe(0);
  });
});
