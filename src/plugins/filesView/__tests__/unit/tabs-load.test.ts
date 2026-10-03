import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { loadTab, readFailure, revalidate } from "../../tabs/load";
import { newTab } from "../../tabs/model";
import type { OpenTab } from "../../types";
import { forbiddenError, hashOf, notFoundError, tooLargeError } from "../fake-files";
import { createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// loadTab: text, image through readBinary, forbidden, too large, missing,
// another wire error without the prefix; revalidate: clean → silent replace,
// dirty → conflict, fresh → no read.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = 1_800_000_000_000;

let ctx: TestCtx;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  ctx = createCtx();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A tab added to the state.
 *
 * @param path - The path.
 * @returns The tab.
 */
function tabOf(path: string): OpenTab {
  const tab = newTab(path);
  ctx.state.tabs.push(tab);
  return tab;
}

describe("loadTab", () => {
  it("reads a text file into saved, buffer and version and notifies", async () => {
    const listener = vi.fn();
    ctx.state.listeners.add(listener);
    const tab = tabOf("nodes/merge.ts");
    await loadTab(ctx, tab);
    expect(tab).toMatchObject({
      status: "ready",
      saved: "export const merge = 1;\n",
      buffer: "export const merge = 1;\n",
      version: hashOf("export const merge = 1;\n"),
      checkedAt: NOW,
      message: undefined
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reads an image through readBinary, never through read", async () => {
    const tab = tabOf(".moku/captures/a.png");
    await loadTab(ctx, tab);
    expect(ctx.files.client.readBinary).toHaveBeenCalledWith(".moku/captures/a.png");
    expect(ctx.files.client.read).not.toHaveBeenCalled();
    expect(tab).toMatchObject({
      status: "ready",
      image: "data:image/png;base64,iVBORw0KGgo=",
      version: hashOf("data:image/png;base64,iVBORw0KGgo="),
      saved: undefined
    });
  });

  it.each([
    [
      "forbidden",
      forbiddenError("x.ts"),
      "error",
      "This file is outside the editor's sandbox.",
      -32_004
    ],
    [
      "too large",
      tooLargeError("x.ts"),
      "error",
      "File too large to open here (over 2 MB)",
      -32_000
    ],
    ["missing", notFoundError("x.ts"), "missing", "The file is gone from disk.", -32_601],
    [
      "another wire error",
      wireError(-32_002, "timeout after 5000 ms", { reason: "timeout" }),
      "error",
      "timeout after 5000 ms",
      -32_002
    ],
    ["a plain error", new Error("[moku-editor] boom"), "error", "boom", undefined]
  ])("shows %s", async (_label, error, status, message, code) => {
    ctx.files.failures.set("read:x.ts", error);
    const tab = tabOf("x.ts");
    await loadTab(ctx, tab);
    expect(tab).toMatchObject({ status, message });
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:read-failed", { path: "x.ts", code });
  });

  it("reports a thrown non-error as an unknown error", () => {
    expect(readFailure("oops")).toEqual({
      status: "error",
      message: "Unknown error",
      code: undefined
    });
  });
});

/**
 * A loaded tab checked `age` ms ago.
 *
 * @param path - The path.
 * @param age - Ms since the last check.
 * @returns The tab.
 */
async function loaded(path: string, age: number): Promise<OpenTab> {
  const tab = tabOf(path);
  await loadTab(ctx, tab);
  vi.setSystemTime(NOW + age);
  ctx.files.client.read.mockClear();
  return tab;
}

describe("revalidate", () => {
  it("does not read a tab checked within revalidateMs", async () => {
    const tab = await loaded("nodes/merge.ts", 500);
    await revalidate(ctx, tab);
    expect(ctx.files.client.read).not.toHaveBeenCalled();
  });

  it("only refreshes checkedAt when the version is the same", async () => {
    const tab = await loaded("nodes/merge.ts", 5000);
    await revalidate(ctx, tab);
    expect(ctx.files.client.read).toHaveBeenCalledTimes(1);
    expect(tab.checkedAt).toBe(NOW + 5000);
    expect(tab.status).toBe("ready");
  });

  it("replaces a clean tab silently when the file changed", async () => {
    const tab = await loaded("nodes/merge.ts", 5000);
    ctx.files.set("nodes/merge.ts", "changed on disk");
    await revalidate(ctx, tab);
    expect(tab).toMatchObject({
      status: "ready",
      saved: "changed on disk",
      buffer: "changed on disk",
      version: hashOf("changed on disk")
    });
  });

  it("marks a modified tab as conflict when the file changed", async () => {
    const tab = await loaded("nodes/merge.ts", 5000);
    tab.buffer = "my edit";
    ctx.files.set("nodes/merge.ts", "their edit");
    await revalidate(ctx, tab);
    expect(tab).toMatchObject({ status: "conflict", buffer: "my edit" });
  });

  it("skips images and tabs that are saving", async () => {
    const image = await loaded(".moku/captures/a.png", 5000);
    await revalidate(ctx, image);
    const saving = await loaded("nodes/merge.ts", 5000);
    saving.status = "saving";
    await revalidate(ctx, saving);
    expect(ctx.files.client.read).not.toHaveBeenCalled();
    expect(ctx.files.client.readBinary).toHaveBeenCalledTimes(1);
  });

  it("marks a tab missing when the file is gone and logs other read errors", async () => {
    const tab = await loaded("nodes/merge.ts", 5000);
    ctx.files.contents.delete("nodes/merge.ts");
    await revalidate(ctx, tab);
    expect(tab).toMatchObject({ status: "missing", message: "The file is gone from disk." });

    const other = await loaded("flows/main.ts", 10_000);
    ctx.files.failures.set("read:flows/main.ts", new Error("[moku-editor] link closed"));
    await revalidate(ctx, other);
    expect(other.status).toBe("ready");
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:revalidate-failed", {
      path: "flows/main.ts",
      code: undefined
    });
  });
});
