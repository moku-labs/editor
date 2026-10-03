// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { actionsOf } from "../../actions";
import { createTestCtx, flush, jumpCamera, prepare } from "../ctx";
import { entry } from "../helpers";

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("focus.select", () => {
  it("selects = focuses: strip opens, the unrelated items dim, the camera moves", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    expect(actions.focus.select("board/merge")).toBe(true);
    expect(actions.focus.selected()).toBe("main/board>board/merge");
    expect(ctx.state.focus.strip).toBe(true);
    const related = actions.focus.related();
    expect(related?.has("main/board>board/merge")).toBe(true);
    expect(related?.has("main/board>board/awaitIntent")).toBe(true);
    expect(related?.has("main/board>stub:board/merge:done")).toBe(true);
    expect(related?.has("main/home")).toBe(false);
    expect(actions.camera.get().z).toBeGreaterThanOrEqual(1);
  });

  it("returns false for an unknown key and keeps the selection", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("main/home");
    expect(actions.focus.select("board/nope")).toBe(false);
    expect(actions.focus.selected()).toBe("main/home");
  });

  it("undefined leaves focus and closes the strip", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("main/home");
    expect(actions.focus.select(undefined)).toBe(true);
    expect(actions.focus.selected()).toBeUndefined();
    expect(ctx.state.focus.strip).toBe(false);
    expect(actions.focus.related()).toBeUndefined();
    expect(actions.focus.leave()).toBe(false);
    actions.focus.select("main/home");
    expect(actions.focus.leave()).toBe(true);
  });

  it("expands the collapsed parents of a node id first", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    expect(actions.focus.select("settingsPopup/open")).toBe(true);
    expect(actions.focus.selected()).toBe("main/settings>settingsPopup/open");
    expect(ctx.state.layout.expanded.has("main/settings")).toBe(true);
    await flush(10);
    expect(ctx.state.layout.result?.byKey["main/settings>settingsPopup/open"]).toMatchObject({
      kind: "node",
      flow: "settingsPopup",
      parent: "main/settings"
    });
  });
});

describe("focus queries", () => {
  it("current() and locateCurrent(): the hub, or the collapsed parent it is inside", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    expect(actions.focus.current()).toBe("board/awaitIntent");
    expect(actions.focus.locateCurrent()?.item.key).toBe("main/board>board/awaitIntent");
    expect(actions.focus.locateCurrent()?.inside).toBeUndefined();
    actions.flows.collapse("main/board");
    await flush(10);
    expect(actions.focus.locateCurrent()?.item.key).toBe("main/board");
    expect(actions.focus.locateCurrent()?.inside).toBe("main/board");
  });

  it("relatedRect covers the selection, else the current node", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    const hub = ctx.state.layout.result?.byKey["main/board>board/awaitIntent"];
    expect(actions.focus.relatedRect()).toEqual({ x: hub?.x, y: hub?.y, w: hub?.w, h: hub?.h });
    actions.focus.select("main/home");
    expect(actions.focus.relatedRect()?.w).toBeGreaterThan(172);
  });
});

describe("focus.walk", () => {
  it("→ walks to the Goes to row, ← to the Comes from row", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("board/tapGenerator");
    actions.focus.highlight("to", 1);
    actions.focus.walk("next");
    expect(actions.focus.selected()).toBe("main/board>board/energy");
    actions.focus.walk("prev");
    expect(actions.focus.selected()).toBe("main/board>board/tapGenerator");
    actions.focus.highlight("to", 0);
    actions.focus.moveHighlight(1);
    expect(ctx.state.focus.highlight).toEqual({ side: "to", index: 1 });
  });
});

describe("focus.step (M5)", () => {
  it("does nothing unless paused", async () => {
    const { ctx, fakes } = createTestCtx();
    expect(await actionsOf(ctx).focus.step()).toBeUndefined();
    expect(fakes.run).not.toHaveBeenCalled();
  });

  it("runs game.step { frames: 1 } through panels.run when paused, also before any render", async () => {
    const { ctx, fakes } = createTestCtx();
    fakes.status = { kind: "paused", frame: 1840 };
    const result = await actionsOf(ctx).focus.step();
    expect(fakes.run).toHaveBeenCalledWith("game.step", { frames: 1 });
    expect(result?.state.frame).toBe(1841);
  });

  it("logs and toasts a failed run, resolves undefined", async () => {
    const { ctx, fakes } = createTestCtx();
    fakes.status = { kind: "paused", frame: 1840 };
    fakes.run.mockRejectedValueOnce(
      wireError(-32_602, "[moku-editor] game.step: frames must be a number")
    );
    expect(await actionsOf(ctx).focus.step()).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalled();
    expect(fakes.workspace.toast).toHaveBeenCalledWith("game.step failed · Logged in Console");
  });

  it("pause and resume run their commands; a failure is toasted", async () => {
    const { ctx, fakes } = createTestCtx();
    await actionsOf(ctx).focus.pause();
    await actionsOf(ctx).focus.resume();
    expect(fakes.run.mock.calls.map(call => call[0])).toEqual(["game.pause", "game.resume"]);
    fakes.run.mockRejectedValueOnce(new Error("[moku-editor] boom"));
    await actionsOf(ctx).focus.pause();
    expect(fakes.workspace.toast).toHaveBeenCalledWith("game.pause failed · Logged in Console");
  });
});

describe("focus.focusFrame", () => {
  it("says so when the history has no frames (until F-H1)", async () => {
    const { ctx, fakes } = createTestCtx();
    await prepare(ctx);
    ctx.state.data.history = [entry(1, "home", "play")];
    expect(actionsOf(ctx).focus.focusFrame(1778)).toBe(false);
    expect(fakes.workspace.toast).toHaveBeenCalledWith("Frames are not recorded in this history");
  });

  it("selects the edge at an exact frame; names the last edge before an inexact one", async () => {
    const { ctx, fakes } = createTestCtx();
    await prepare(ctx);
    ctx.state.data.history = [
      entry(1, "home", "play", { frame: 1700 }),
      entry(2, "board/merge", "rejected", { frame: 1778, payload: { reason: "empty" } })
    ];
    const actions = actionsOf(ctx);
    expect(actions.focus.focusFrame(1778)).toBe(true);
    expect(ctx.state.focus.edge).toBe("board/merge:rejected");
    expect(actions.focus.selected()).toBe("main/board>board/merge");
    expect(fakes.workspace.toast).toHaveBeenCalledWith("Frame 1778 · board/merge · rejected");
    expect(actions.focus.focusFrame(1790)).toBe(true);
    expect(fakes.workspace.toast).toHaveBeenCalledWith(
      "No edge at frame 1790 · last edge before it f1778 · board/merge"
    );
    expect(actions.focus.focusFrame(10)).toBe(true);
    expect(fakes.workspace.toast).toHaveBeenCalledWith("No edge at frame 10");
  });

  it("marks the history entry of an exact frame as the selected row", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    ctx.state.data.history = [
      entry(1, "home", "play", { frame: 1700 }),
      entry(2, "board/merge", "rejected", { frame: 1778 })
    ];
    expect(actionsOf(ctx).focus.focusFrame(1778)).toBe(true);
    expect(ctx.state.focus.edge).toBe("board/merge:rejected");
    expect(ctx.state.focus.historySelected).toBe(2);
  });

  it("selectHistory selects an entry's edge", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    ctx.state.data.history = [entry(5, "board/merge", "done")];
    actionsOf(ctx).focus.selectHistory(5);
    expect(ctx.state.focus.edge).toBe("board/merge:done");
    expect(ctx.state.focus.historySelected).toBe(5);
    actionsOf(ctx).focus.hoverHistory(5);
    expect(ctx.state.focus.historyHover).toBe(5);
  });
});

describe("history strip and menus", () => {
  it("toggles the history strip and closes the context menu", () => {
    const { ctx } = createTestCtx();
    const focus = actionsOf(ctx).focus;
    expect(focus.history()).toBe(true);
    expect(focus.history(false)).toBe(false);
    expect(focus.closeMenu()).toBe(false);
    focus.openMenu({ target: "canvas", key: undefined, outcome: undefined, x: 10, y: 10 });
    expect(ctx.state.focus.menu?.target).toBe("canvas");
    expect(focus.closeMenu()).toBe(true);
    expect(ctx.state.focus.menu).toBeUndefined();
  });
});
