import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { findTab } from "../../tabs/model";
import { openTab } from "../../tabs/open";
import { resolveConflict, saveTab, shouldReload } from "../../tabs/save";
import type { SaveResult } from "../../types";
import { hashOf } from "../fake-files";
import { CONFIG, createCtx, settle, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The save flow: unchanged → no write; saved → toast; D-07 reload only for game
// sources outside .moku/ while live or paused; conflict; resolve reload and
// overwrite.
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
    expect(ctx.workspace.reload).toHaveBeenCalledWith({
      restore: true,
      afterSave: true,
      since: expect.any(Number)
    });
    expect(findTab(ctx.state, "nodes/merge.ts")).toMatchObject({
      status: "ready",
      saved: "export const merge = 2;\n// more\n",
      version: hashOf("export const merge = 2;\n// more\n")
    });
    expect(ctx.state.index.files.get("nodes/merge.ts")?.size).toBe(32);
  });

  it("hands the reload the moment taken before the write (A2)", async () => {
    const { client } = ctx.files;
    const write = client.write.getMockImplementation();
    let writeStartedAt = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_759_680_000_000);
    client.write.mockImplementationOnce(async (path, text, version) => {
      // The write takes half a second: a moment taken after it would be later.
      writeStartedAt = Date.now();
      vi.setSystemTime(writeStartedAt + 500);
      if (write === undefined) throw new Error("no write");
      return write(path, text, version);
    });
    await edited("nodes/merge.ts", "export const merge = 2;\n");
    await saveTab(ctx, "nodes/merge.ts");
    expect(writeStartedAt).toBe(1_759_680_000_000);
    expect(ctx.workspace.reload).toHaveBeenCalledWith({
      restore: true,
      afterSave: true,
      since: writeStartedAt
    });
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
    ["a .moku/ json save", ".moku/editor/layout.json", { kind: "live", frame: 1 }],
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
});

/**
 * Holds the answer of every later call of a files mock until the returned release.
 *
 * @param mock - `ctx.files.client.write` or `.read`.
 * @returns Lets the held calls answer.
 */
function hold<A extends unknown[], R>(mock: Mock<(...args: A) => Promise<R>>): () => void {
  const gate = Promise.withResolvers<void>();
  const original = mock.getMockImplementation();
  if (original === undefined) throw new Error("the files fake has no implementation");
  mock.mockImplementation(async (...args: A) => {
    await gate.promise;
    return original(...args);
  });
  return () => gate.resolve();
}

/**
 * The text and version of every write, in call order.
 *
 * @returns The calls.
 */
function writes(): unknown[][] {
  return ctx.files.client.write.mock.calls.map(([, text, version]) => [text, version]);
}

describe("saveTab while a write is in flight", () => {
  const PATH = "nodes/merge.ts";
  const ORIGINAL = "export const merge = 1;\n";

  it("queues one save of the newer buffer; repeated asks share it", async () => {
    await edited(PATH, "first");
    const release = hold(ctx.files.client.write);
    const first = saveTab(ctx, PATH);
    expect(findTab(ctx.state, PATH)?.status).toBe("saving");

    const tab = findTab(ctx.state, PATH);
    if (tab) tab.buffer = "second";
    const second = saveTab(ctx, PATH);
    const third = saveTab(ctx, PATH);
    await settle();
    expect(writes()).toEqual([["first", hashOf(ORIGINAL)]]);

    release();
    expect(await first).toMatchObject({ kind: "saved", version: hashOf("first") });
    const queued = await second;
    expect(queued).toMatchObject({ kind: "saved", version: hashOf("second") });
    expect(await third).toEqual(queued);
    expect(writes()).toEqual([
      ["first", hashOf(ORIGINAL)],
      ["second", hashOf("first")]
    ]);
    expect(ctx.files.contents.get(PATH)).toBe("second");
    expect(findTab(ctx.state, PATH)).toMatchObject({ status: "ready", saved: "second" });
  });

  it("the queued save writes nothing when the buffer did not change since", async () => {
    await edited(PATH, "first");
    const release = hold(ctx.files.client.write);
    const first = saveTab(ctx, PATH);
    const again = saveTab(ctx, PATH);
    release();
    await first;
    expect(await again).toEqual({ kind: "unchanged" });
    expect(writes()).toEqual([["first", hashOf(ORIGINAL)]]);
  });

  it("a later save after the write landed writes at once", async () => {
    await edited(PATH, "first");
    await saveTab(ctx, PATH);
    const tab = findTab(ctx.state, PATH);
    if (tab) tab.buffer = "second";
    expect(await saveTab(ctx, PATH)).toMatchObject({ kind: "saved", version: hashOf("second") });
    expect(writes()).toEqual([
      ["first", hashOf(ORIGINAL)],
      ["second", hashOf("first")]
    ]);
  });

  it("a save during an untracked write (Overwrite) answers Nothing to save", async () => {
    await edited(PATH, "mine");
    const release = hold(ctx.files.client.write);
    const overwrite = resolveConflict(ctx, PATH, "overwrite");
    await settle();
    expect(findTab(ctx.state, PATH)?.status).toBe("saving");
    expect(await saveTab(ctx, PATH)).toEqual({
      kind: "failed",
      code: undefined,
      message: "Nothing to save"
    });
    release();
    expect(await overwrite).toMatchObject({ kind: "saved" });
  });

  it("a write started while the previous one finishes keeps its own tracking", async () => {
    const path = "README.md";
    await edited(path, "first\n");
    const tab = findTab(ctx.state, path);
    let second: Promise<SaveResult> | undefined;
    let releaseWrite: (() => void) | undefined;
    // The toast of the first save runs after its write landed, before its tracking ends.
    ctx.workspace.toast.mockImplementationOnce(() => {
      if (tab) tab.buffer = "second\n";
      releaseWrite = hold(ctx.files.client.write);
      second = saveTab(ctx, path);
    });
    expect(await saveTab(ctx, path)).toMatchObject({ kind: "saved" });

    // The first write's end must not forget the second one: a save now queues behind it.
    if (tab) tab.buffer = "third\n";
    const third = saveTab(ctx, path);
    releaseWrite?.();
    expect(await second).toMatchObject({ kind: "saved" });
    expect(await third).toMatchObject({ kind: "saved", version: hashOf("third\n") });
    expect(writes().map(([text]) => text)).toEqual(["first\n", "second\n", "third\n"]);
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
