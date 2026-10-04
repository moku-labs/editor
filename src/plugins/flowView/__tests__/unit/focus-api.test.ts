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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("focus.select", () => {
  it("selects = focuses: the unrelated items dim, the camera moves", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    expect(actions.focus.select("board/merge")).toBe(true);
    expect(actions.focus.selected()).toBe("main/board>board/merge");
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

  it("undefined leaves focus", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("main/home");
    expect(actions.focus.select(undefined)).toBe(true);
    expect(actions.focus.selected()).toBeUndefined();
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
  it("→ walks to the Outcomes row, ← to the Comes from row, along their edges", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("board/tapGenerator");
    actions.focus.highlight("to", 1);
    actions.focus.walk("next");
    expect(actions.focus.selected()).toBe("main/board>board/energy");
    expect(ctx.state.focus.edge).toBe("main/board>board/tapGenerator:noEnergy");
    actions.focus.walk("prev");
    expect(actions.focus.selected()).toBe("main/board>board/tapGenerator");
    actions.focus.highlight("to", 0);
    actions.focus.moveHighlight(1);
    expect(ctx.state.focus.highlight).toEqual({ side: "to", index: 1 });
  });

  it("followHighlight follows the highlighted row's edge; without a highlight it does nothing", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.flows.collapse("main/board");
    await flush(10);
    actions.focus.select("main/home");
    actions.focus.highlight("to", 0);
    expect(actions.focus.followHighlight()).toBe(true);
    expect(actions.focus.selected()).toBe("main/board");
    expect(actions.focus.followHighlight()).toBe(false);
  });
});

describe("focus.followEdge (finding 14)", () => {
  it("an Outcomes edge selects its target instance, marks the edge, frames both ends and pulses for 600 ms", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const actions = actionsOf(ctx);
    actions.focus.select("board/merge");
    const frame = vi.spyOn(actions.camera, "frameItems");
    expect(actions.focus.followEdge("main/board>board/merge:done")).toBe(true);
    expect(actions.focus.selected()).toBe("main/board>board/awaitIntent");
    expect(ctx.state.focus.edge).toBe("main/board>board/merge:done");
    expect(frame).toHaveBeenCalledWith(["main/board>board/merge", "main/board>board/awaitIntent"]);
    expect(ctx.state.focus.pulse).toBe("main/board>board/awaitIntent");
    expect(ctx.state.focus.back).toEqual(["main/board>board/merge"]);
    vi.advanceTimersByTime(599);
    expect(ctx.state.focus.pulse).toBe("main/board>board/awaitIntent");
    vi.advanceTimersByTime(1);
    expect(ctx.state.focus.pulse).toBeUndefined();
    vi.useRealTimers();
  });

  it("a Comes from edge selects the source; the camera fits both ends", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("board/merge");
    expect(actions.focus.followEdge("main/board>board/awaitIntent:merge")).toBe(true);
    expect(actions.focus.selected()).toBe("main/board>board/awaitIntent");
    const byKey = ctx.state.layout.result?.byKey;
    const cam = actions.camera.get();
    for (const key of ["main/board>board/merge", "main/board>board/awaitIntent"]) {
      const item = byKey?.[key];
      if (item === undefined) throw new Error(`no ${key}`);
      expect(item.x * cam.z + cam.x).toBeGreaterThanOrEqual(0);
      expect((item.x + item.w) * cam.z + cam.x).toBeLessThanOrEqual(1200);
      expect(item.y * cam.z + cam.y).toBeGreaterThanOrEqual(0);
      expect((item.y + item.h) * cam.z + cam.y).toBeLessThanOrEqual(800);
    }
  });

  it("an exit goes on through its frame's edge; a via edge walks back out of the frame", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("board/giveToOrder");
    expect(actions.focus.followEdge("main/board>board/giveToOrder:orderComplete")).toBe(true);
    expect(actions.focus.selected()).toBe("main/afterOrder");
    actions.focus.select("board/awaitIntent");
    expect(actions.focus.followEdge("main/home:play")).toBe(true);
    expect(actions.focus.selected()).toBe("main/home");
  });

  it("only the followed instance's edge is selected (one key per instance)", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.flows.expand("main/settings");
    actions.flows.expand("main/board>board/settings");
    await flush(10);
    actions.focus.select("main/settings>settingsPopup/open");
    expect(actions.focus.followEdge("main/settings>settingsPopup/open:close")).toBe(true);
    const selected = (ctx.state.layout.result?.edges ?? []).filter(
      edge => edge.kind === "edge" && edge.key === ctx.state.focus.edge
    );
    expect(selected.map(edge => edge.from)).toEqual(["main/settings>settingsPopup/open"]);
  });

  it("returns false for an edge that is not drawn; Back returns, Esc empties the stack", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    expect(actions.focus.followEdge("main/nope:x")).toBe(false);
    expect(ctx.state.focus.back).toEqual([]);
    expect(actions.focus.followEdge("main/home:play")).toBe(true);
    expect(ctx.state.focus.back).toEqual([undefined]);
    expect(actions.focus.back()).toBe(true);
    expect(actions.focus.selected()).toBeUndefined();
    expect(actions.focus.back()).toBe(false);
    actions.focus.select("board/merge");
    actions.focus.followEdge("main/board>board/merge:done");
    actions.focus.followEdge("main/board>board/awaitIntent:tap");
    expect(ctx.state.focus.back).toHaveLength(2);
    expect(actions.focus.leave()).toBe(true);
    expect(ctx.state.focus.back).toEqual([]);
  });

  it("Back reselects a key that left the canvas through select", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("board/merge");
    actions.focus.followEdge("main/board>board/merge:done");
    ctx.state.focus.back = ["settingsPopup/open"];
    expect(actions.focus.back()).toBe(true);
    expect(actions.focus.selected()).toBe("main/settings>settingsPopup/open");
  });
});

describe("camera.frameItems and focus.findCurrent", () => {
  it("frameItems fits the placed keys, false when none is placed", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    expect(actions.camera.frameItems(["nope"])).toBe(false);
    expect(actions.camera.frameItems(["main/home", "nope"])).toBe(true);
    const home = ctx.state.layout.result?.byKey["main/home"];
    const cam = actions.camera.get();
    expect(((home?.x ?? 0) + (home?.w ?? 0) / 2) * cam.z + cam.x).toBeCloseTo(600, 0);
  });

  it("findCurrent moves onto the current node with a pulse and keeps the selection", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("main/home");
    const focusItem = vi.spyOn(actions.camera, "focusItem");
    expect(actions.focus.findCurrent()).toBe(true);
    expect(focusItem).toHaveBeenCalledWith(
      expect.objectContaining({ key: "main/board>board/awaitIntent" })
    );
    expect(ctx.state.focus.pulse).toBe("main/board>board/awaitIntent");
    expect(actions.focus.selected()).toBe("main/home");
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
    expect(ctx.state.focus.edge).toBe("main/board>board/merge:rejected");
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
    expect(ctx.state.focus.edge).toBe("main/board>board/merge:rejected");
    expect(ctx.state.focus.historySelected).toBe(2);
  });

  it("selectHistory selects an entry's edge", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    ctx.state.data.history = [entry(5, "board/merge", "done")];
    actionsOf(ctx).focus.selectHistory(5);
    expect(ctx.state.focus.edge).toBe("main/board>board/merge:done");
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
