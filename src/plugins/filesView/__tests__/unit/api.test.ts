import { describe, expect, it, vi } from "vitest";
import { createFilesViewApi } from "../../api";
import { rebuildUsedBy } from "../../links/used-by";
import { createFilesViewState } from "../../state";
import { notify, subscribe } from "../../store";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The api, member by member, over a mock ctx with the fake files; the state
// factory and the store.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ctx and its api with the index built and the graph loaded.
 *
 * @returns Both.
 */
async function ready() {
  const ctx = createCtx();
  const api = createFilesViewApi(ctx);
  ctx.state.graph = ctx.link.graph;
  await api.refresh();
  return { ctx, api };
}

describe("createFilesViewState", () => {
  it("starts empty", () => {
    const state = createFilesViewState();
    expect(state).toMatchObject({
      index: undefined,
      indexing: undefined,
      tabs: [],
      active: undefined,
      graph: undefined,
      overrides: {},
      usedBy: undefined,
      confirmClose: undefined,
      removers: [],
      paletteRemover: undefined
    });
    expect(state.expanded.size).toBe(0);
    expect(state.listeners.size).toBe(0);
    expect(createFilesViewState().tabs).not.toBe(state.tabs);
  });
});

describe("store", () => {
  it("notifies every listener; unsubscribe is idempotent", () => {
    const state = createFilesViewState();
    const first = vi.fn();
    const second = vi.fn();
    const off = subscribe(state, first);
    subscribe(state, second);
    notify(state);
    off();
    off();
    notify(state);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("keeps notifying the others when a listener unsubscribes during a notify", () => {
    const state = createFilesViewState();
    const second = vi.fn();
    const off = subscribe(state, () => off());
    subscribe(state, second);
    notify(state);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("createFilesViewApi", () => {
  it("open, tabs, active, activate and close", async () => {
    const { ctx, api } = await ready();
    await api.open("nodes/merge.ts", { line: 3 });
    await api.open("flows/board.ts");
    expect(api.active()).toBe("flows/board.ts");
    api.activate("nodes/merge.ts");
    expect(api.active()).toBe("nodes/merge.ts");
    expect(api.tabs()).toEqual([
      { path: "nodes/merge.ts", kind: "code", modified: false, editing: false, status: "ready" },
      { path: "flows/board.ts", kind: "code", modified: false, editing: false, status: "ready" }
    ]);
    api.setBuffer("nodes/merge.ts", "changed");
    expect(api.tabs()[0]?.modified).toBe(true);
    expect(api.close("nodes/merge.ts")).toBe(false);
    expect(ctx.state.confirmClose).toBe("nodes/merge.ts");
    expect(api.close("nodes/merge.ts", { discard: true })).toBe(true);
    expect(api.tabs().map(tab => tab.path)).toEqual(["flows/board.ts"]);
  });

  it("edit, setMode and save", async () => {
    const { ctx, api } = await ready();
    expect(await api.save()).toEqual({
      kind: "failed",
      code: undefined,
      message: "Nothing to save"
    });
    api.edit(true);
    await api.open(".moku/notes/2026-09-24-first.md");
    api.setMode(".moku/notes/2026-09-24-first.md", "source");
    expect(ctx.state.tabs[0]?.mode).toBe("source");
    await api.open("nodes/merge.ts");
    api.edit(true);
    expect(api.tabs()[1]?.editing).toBe(true);
    api.setBuffer("nodes/merge.ts", "export const merge = 2;\n");
    const result1 = await api.save();
    expect(result1.kind).toBe("saved");
    const result2 = await api.save("nodes/merge.ts");
    expect(result2.kind).toBe("unchanged");
    api.edit(false, "nodes/merge.ts");
    expect(api.tabs()[1]?.editing).toBe(false);
  });

  it("resolveConflict overwrites with the fresh version", async () => {
    const { ctx, api } = await ready();
    await api.open("nodes/merge.ts", { edit: true });
    api.setBuffer("nodes/merge.ts", "mine");
    ctx.files.set("nodes/merge.ts", "theirs");
    const result3 = await api.save();
    expect(result3.kind).toBe("conflict");
    const result4 = await api.resolveConflict("nodes/merge.ts", "overwrite");
    expect(result4.kind).toBe("saved");
    expect(ctx.files.contents.get("nodes/merge.ts")).toBe("mine");
  });

  it("refresh and files list the index in tree order", async () => {
    const { api } = await ready();
    expect(api.files().map(entry => entry.path)).toEqual([
      ".moku/captures/series-2026-09-24-1015/index.json",
      ".moku/captures/a.png",
      ".moku/editor/files.json",
      ".moku/notes/2026-09-24-first.md",
      "features/settings/nodes.ts",
      "flows/board.ts",
      "flows/main.ts",
      "nodes/await-intent.ts",
      "nodes/merge.ts",
      "README.md"
    ]);
    expect(createFilesViewApi(createCtx()).files()).toEqual([]);
  });

  it("fileOf, flowFileOf and usedBy follow the protocol rule against the index", async () => {
    const { api } = await ready();
    expect(api.fileOf({ flow: "board", node: "awaitIntent" })).toBe("nodes/await-intent.ts");
    expect(api.fileOf({ flow: "main", node: "board" })).toBeUndefined();
    expect(api.fileOf({ flow: "settingsPopup", node: "open" })).toBe("features/settings/nodes.ts");
    expect(api.flowFileOf("board")).toBe("flows/board.ts");
    expect(api.flowFileOf("rewardPopup")).toBeUndefined();
    expect(api.usedBy("nodes/merge.ts")).toEqual({
      flows: [],
      nodes: [{ flow: "board", node: "merge" }]
    });
    expect(api.usedBy("flows/board.ts")).toEqual({ flows: ["board"], nodes: [] });
    expect(api.usedBy("README.md")).toEqual({ flows: [], nodes: [] });
  });

  it("fileOf and usedBy prefer a graph node's own file (F-H2), like flowView", async () => {
    const { ctx, api } = await ready();
    ctx.state.graph = {
      main: "board",
      flows: { board: { start: "merge", edges: {}, nodes: { merge: { file: "features/x.ts" } } } }
    };
    rebuildUsedBy(ctx);
    expect(api.fileOf({ flow: "board", node: "merge" })).toBe("features/x.ts");
    expect(api.usedBy("features/x.ts")).toEqual({
      flows: [],
      nodes: [{ flow: "board", node: "merge" }]
    });
    expect(api.usedBy("nodes/merge.ts").nodes).toEqual([]);
  });

  it("usedBy and fileOf work without a graph or an index", () => {
    const api = createFilesViewApi(createCtx());
    expect(api.usedBy("nodes/merge.ts")).toEqual({ flows: [], nodes: [] });
    expect(api.fileOf({ flow: "board", node: "merge" })).toBeUndefined();
  });

  it("editorUrl builds the D-08 link from the boot data", () => {
    const ctx = createCtx();
    const api = createFilesViewApi(ctx);
    expect(api.editorUrl("nodes/merge.ts", 12)).toBe(
      "vscode://file/Users/moku/game/nodes/merge.ts:12"
    );
    expect(api.editorUrl("nodes/merge.ts")).toBe("vscode://file/Users/moku/game/nodes/merge.ts:1");
    ctx.link.bootValue = undefined;
    expect(api.editorUrl("nodes/merge.ts")).toBeUndefined();
  });

  it("subscribe hears changes until unsubscribed", async () => {
    const { api } = await ready();
    const fn = vi.fn();
    const off = api.subscribe(fn);
    await api.open("nodes/merge.ts");
    expect(fn).toHaveBeenCalled();
    off();
    fn.mockClear();
    api.setBuffer("nodes/merge.ts", "x");
    expect(fn).not.toHaveBeenCalled();
  });
});
