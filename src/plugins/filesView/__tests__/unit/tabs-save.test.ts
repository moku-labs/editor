import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { findTab } from "../../tabs/model";
import { openTab } from "../../tabs/open";
import { resolveConflict, saveTab, shouldReload } from "../../tabs/save";
import { hashOf } from "../fake-files";
import { CONFIG, createCtx, GRAPH, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The save flow: unchanged → no write; saved → toast; D-07 reload only for game
// sources outside .moku/ while live or paused; conflict; resolve reload and
// overwrite; saving the override file rebuilds Used by.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  ctx = createCtx();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Opens a tab and puts text in its buffer.
 *
 * @param path - The path.
 * @param text - The buffer.
 */
async function edited(path: string, text: string): Promise<void> {
  await openTab(ctx, path, { edit: true });
  const tab = findTab(ctx.state, path);
  if (tab) tab.buffer = text;
}

describe("saveTab", () => {
  it("writes nothing for an unchanged buffer and shows ✓ No changes for 2 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await openTab(ctx, "nodes/merge.ts", {});
    expect(await saveTab(ctx, "nodes/merge.ts")).toEqual({ kind: "unchanged" });
    expect(ctx.files.client.write).not.toHaveBeenCalled();
    expect(ctx.workspace.toast).not.toHaveBeenCalled();
    expect(findTab(ctx.state, "nodes/merge.ts")?.message).toBe("✓ No changes");
    vi.advanceTimersByTime(2000);
    expect(findTab(ctx.state, "nodes/merge.ts")?.message).toBeUndefined();
  });

  it("keeps a newer message when the No changes note expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await openTab(ctx, "nodes/merge.ts", {});
    await saveTab(ctx, "nodes/merge.ts");
    const tab = findTab(ctx.state, "nodes/merge.ts");
    if (tab) tab.message = "other";
    vi.advanceTimersByTime(2000);
    expect(tab?.message).toBe("other");
  });

  it("refuses a tab that is not ready or not open", async () => {
    expect(await saveTab(ctx, "nope.ts")).toEqual({
      kind: "failed",
      code: undefined,
      message: "Nothing to save"
    });
    await openTab(ctx, ".moku/captures/a.png", {});
    const result1 = await saveTab(ctx, ".moku/captures/a.png");
    expect(result1.kind).toBe("failed");
  });

  it("answers conflict without writing while the tab is in conflict", async () => {
    await edited("nodes/merge.ts", "mine");
    const tab = findTab(ctx.state, "nodes/merge.ts");
    if (tab) tab.status = "conflict";
    expect(await saveTab(ctx, "nodes/merge.ts")).toEqual({ kind: "conflict" });
    expect(ctx.files.client.write).not.toHaveBeenCalled();
  });

  it("writes with the version, toasts the file and reloads the game for a .ts save while live", async () => {
    ctx.state.index = {
      files: new Map([["nodes/merge.ts", { path: "nodes/merge.ts", kind: "file", size: 24 }]]),
      children: new Map(),
      builtAt: 1,
      truncated: false
    };
    await edited("nodes/merge.ts", "export const merge = 2;\n// more\n");
    const result = await saveTab(ctx, "nodes/merge.ts");
    expect(ctx.files.client.write).toHaveBeenCalledWith(
      "nodes/merge.ts",
      "export const merge = 2;\n// more\n",
      hashOf("export const merge = 1;\n")
    );
    expect(result).toEqual({
      kind: "saved",
      path: "nodes/merge.ts",
      bytes: 32,
      version: hashOf("export const merge = 2;\n// more\n"),
      reload: true
    });
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Saved", "nodes/merge.ts");
    expect(ctx.workspace.reload).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.reload).toHaveBeenCalledWith({ restore: true });
    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      status: "ready",
      saved: "export const merge = 2;\n// more\n",
      version: hashOf("export const merge = 2;\n// more\n")
    });
    expect(ctx.state.index.files.get("nodes/merge.ts")?.size).toBe(32);
  });

  it("reloads while paused too, and logs a failed reload", async () => {
    ctx.link.statusValue = { kind: "paused", frame: 3 };
    ctx.workspace.reload.mockRejectedValueOnce(new Error("frame gone"));
    await edited("nodes/merge.ts", "x");
    const result2 = await saveTab(ctx, "nodes/merge.ts");
    expect(result2.kind).toBe("saved");
    await Promise.resolve();
    expect(ctx.workspace.reload).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:reload-failed", { message: "frame gone" });
  });

  it.each([
    ["a .md save", ".moku/notes/2026-09-24-first.md", { kind: "live", frame: 1 }],
    ["a .moku/ json save", ".moku/editor/files.json", { kind: "live", frame: 1 }],
    ["a save with no game", "nodes/merge.ts", { kind: "empty" }],
    ["a save while connecting", "nodes/merge.ts", { kind: "connecting" }]
  ] as const)("does not reload for %s", async (_label, path, status) => {
    ctx.link.statusValue = status;
    await edited(path, "{}\n");
    const result = await saveTab(ctx, path);
    expect(result).toMatchObject({ kind: "saved", reload: false });
    expect(ctx.workspace.reload).not.toHaveBeenCalled();
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Saved", path);
  });

  it("shows the conflict when the version is stale", async () => {
    await edited("nodes/merge.ts", "mine");
    ctx.files.set("nodes/merge.ts", "theirs");
    expect(await saveTab(ctx, "nodes/merge.ts")).toEqual({ kind: "conflict" });
    expect(findTab(ctx.state, "nodes/merge.ts")?.status).toBe("conflict");
    expect(ctx.workspace.toast).not.toHaveBeenCalled();
  });

  it("reports another write error without the prefix and logs it", async () => {
    await edited("nodes/merge.ts", "mine");
    ctx.files.failures.set(
      "write:nodes/merge.ts",
      wireError(-32_602, "write: text over 2 MiB: nodes/merge.ts", { reason: "invalid_input" })
    );
    expect(await saveTab(ctx, "nodes/merge.ts")).toEqual({
      kind: "failed",
      code: -32_602,
      message: "write: text over 2 MiB: nodes/merge.ts"
    });
    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      status: "ready",
      message: "write: text over 2 MiB: nodes/merge.ts"
    });
    expect(ctx.log.error).toHaveBeenCalledWith("filesView:save-failed", {
      path: "nodes/merge.ts",
      code: -32_602
    });
  });

  it("rebuilds Used by after saving the override file", async () => {
    ctx.state.graph = GRAPH;
    ctx.state.index = {
      files: new Map(
        ["flows/board.ts", "features/settings/nodes.ts", ".moku/editor/files.json"].map(path => [
          path,
          { path, kind: "file" as const, size: 1 }
        ])
      ),
      children: new Map(),
      builtAt: 1,
      truncated: false
    };
    await edited(".moku/editor/files.json", '{ "board": "features/settings/nodes.ts" }');
    await saveTab(ctx, ".moku/editor/files.json");
    expect(ctx.state.overrides).toEqual({ board: "features/settings/nodes.ts" });
    expect(ctx.state.usedBy?.get("features/settings/nodes.ts")?.flows).toEqual(["board"]);
  });
});

describe("resolveConflict", () => {
  it("reload re-reads the file, drops the buffer and stays in edit mode", async () => {
    await edited("nodes/merge.ts", "mine");
    ctx.files.set("nodes/merge.ts", "theirs");
    await saveTab(ctx, "nodes/merge.ts");
    expect(await resolveConflict(ctx, "nodes/merge.ts", "reload")).toEqual({ kind: "unchanged" });
    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      status: "ready",
      saved: "theirs",
      buffer: "theirs",
      version: hashOf("theirs"),
      editing: true
    });
  });

  it("overwrite writes the buffer with the fresh version", async () => {
    await edited("nodes/merge.ts", "mine");
    ctx.files.set("nodes/merge.ts", "theirs");
    await saveTab(ctx, "nodes/merge.ts");
    ctx.files.client.write.mockClear();
    const result = await resolveConflict(ctx, "nodes/merge.ts", "overwrite");
    expect(ctx.files.client.write).toHaveBeenCalledWith("nodes/merge.ts", "mine", hashOf("theirs"));
    expect(result).toMatchObject({ kind: "saved", path: "nodes/merge.ts" });
    expect(ctx.files.contents.get("nodes/merge.ts")).toBe("mine");
  });

  it("overwrite re-creates a file that is gone, without a version", async () => {
    await edited("nodes/merge.ts", "mine");
    ctx.files.contents.delete("nodes/merge.ts");
    const result = await resolveConflict(ctx, "nodes/merge.ts", "overwrite");
    expect(ctx.files.client.write).toHaveBeenLastCalledWith("nodes/merge.ts", "mine", undefined);
    expect(result.kind).toBe("saved");
  });

  it("reports a read error of reload and of overwrite", async () => {
    await edited("nodes/merge.ts", "mine");
    ctx.files.failures.set(
      "read:nodes/merge.ts",
      wireError(-32_004, "forbidden path: nodes/merge.ts", { reason: "forbidden_path" })
    );
    expect(await resolveConflict(ctx, "nodes/merge.ts", "reload")).toEqual({
      kind: "failed",
      code: -32_004,
      message: "This file is outside the editor's sandbox."
    });
    expect(await resolveConflict(ctx, "nodes/merge.ts", "overwrite")).toEqual({
      kind: "failed",
      code: -32_004,
      message: "This file is outside the editor's sandbox."
    });
  });

  it("refuses a path that is not open", async () => {
    const result3 = await resolveConflict(ctx, "nope.ts", "overwrite");
    expect(result3.kind).toBe("failed");
  });
});

describe("shouldReload", () => {
  it("is true for game source extensions outside .moku/", () => {
    expect(shouldReload("nodes/merge.ts", CONFIG)).toBe(true);
    expect(shouldReload("features/ui/kit.TSX", CONFIG)).toBe(true);
    expect(shouldReload("styles/a.css", CONFIG)).toBe(true);
    expect(shouldReload("manifest.json", CONFIG)).toBe(true);
    expect(shouldReload(".moku/editor/layout.json", CONFIG)).toBe(false);
    expect(shouldReload("README.md", CONFIG)).toBe(false);
  });
});
