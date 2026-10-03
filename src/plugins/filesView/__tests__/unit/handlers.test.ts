import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandlers, handleOpenFile, onLinkStatus, onWorkspaceChanged } from "../../handlers";
import { findTab } from "../../tabs/model";
import { openTab } from "../../tabs/open";
import { INDEX_STALE_MS } from "../../types";
import { createCtx, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Hooks of the global tools events: an index build on link:status after a
// failure, Files shown with a stale index rebuilds, workspace:open-file opens
// the tab at the line and shows Files.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

describe("createHandlers", () => {
  it("hooks the three global events", () => {
    expect(Object.keys(createHandlers(createCtx()))).toEqual([
      "link:status",
      "workspace:changed",
      "workspace:open-file"
    ]);
  });
});

describe("onLinkStatus", () => {
  it("builds the index after a failed build and notifies", async () => {
    const ctx = createCtx();
    const listener = vi.fn();
    ctx.state.listeners.add(listener);
    onLinkStatus(ctx)({ status: { kind: "live", frame: 1 } });
    expect(listener).toHaveBeenCalled();
    expect(ctx.state.indexing).toBeInstanceOf(Promise);
    await settle();
    await ctx.state.indexing;
    expect(ctx.state.index?.files.size).toBeGreaterThan(0);
  });

  it("does not build again while an index exists or a build runs", async () => {
    const ctx = createCtx();
    onLinkStatus(ctx)({ status: { kind: "connecting" } });
    onLinkStatus(ctx)({ status: { kind: "live", frame: 1 } });
    await ctx.state.indexing;
    onLinkStatus(ctx)({ status: { kind: "paused", frame: 2 } });
    expect(ctx.state.indexing).toBeUndefined();
    expect(ctx.files.listed.filter(dir => dir === "")).toHaveLength(1);
  });
});

describe("onWorkspaceChanged", () => {
  it("rebuilds a stale index when Files is shown, not for other workspaces", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ctx = createCtx();
    onWorkspaceChanged(ctx)({ ws: "files" });
    await ctx.state.indexing;
    expect(ctx.files.listed.filter(dir => dir === "")).toHaveLength(1);

    onWorkspaceChanged(ctx)({ ws: "files" });
    expect(ctx.state.indexing).toBeUndefined();

    vi.setSystemTime(Date.now() + INDEX_STALE_MS + 1);
    onWorkspaceChanged(ctx)({ ws: "flow" });
    expect(ctx.state.indexing).toBeUndefined();
    onWorkspaceChanged(ctx)({ ws: "files" });
    await ctx.state.indexing;
    expect(ctx.files.listed.filter(dir => dir === "")).toHaveLength(2);
  });

  it("revalidates the active tab when Files is shown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ctx = createCtx();
    await openTab(ctx, "nodes/merge.ts", {});
    ctx.state.index = {
      files: new Map(),
      children: new Map(),
      builtAt: Date.now(),
      truncated: false
    };
    ctx.files.set("nodes/merge.ts", "changed");
    vi.setSystemTime(Date.now() + 5000);
    onWorkspaceChanged(ctx)({ ws: "files" });
    await settle();
    expect(findTab(ctx.state, "nodes/merge.ts")?.saved).toBe("changed");
  });
});

describe("handleOpenFile", () => {
  it("opens the tab at the line and shows Files", async () => {
    const ctx = createCtx();
    handleOpenFile(ctx)({ path: "flows/board.ts", line: 3 });
    await settle();
    expect(ctx.workspace.show).toHaveBeenCalledWith("files");
    expect(ctx.state.active).toBe("flows/board.ts");
    expect(findTab(ctx.state, "flows/board.ts")).toMatchObject({ line: 3, status: "ready" });
  });

  it("opens without a line and logs a failure", async () => {
    const ctx = createCtx();
    handleOpenFile(ctx)({ path: "README.md" });
    await settle();
    expect(findTab(ctx.state, "README.md")?.line).toBeUndefined();
    ctx.workspace.show.mockImplementationOnce(() => {
      throw new Error("no shell");
    });
    handleOpenFile(ctx)({ path: "flows/main.ts" });
    await settle();
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:open-failed", {
      path: "flows/main.ts",
      message: "no shell"
    });
  });
});
