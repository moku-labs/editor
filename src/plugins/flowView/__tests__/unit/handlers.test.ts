// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryable } from "../../../registry/protocol";
import { actionsOf } from "../../actions";
import { answerNode, createHandlers } from "../../handlers";
import { startFlowView } from "../../lifecycle";
import { infoView } from "../../view-model";
import { createTestCtx, flush, jumpCamera, prepare, type TestCtx } from "../ctx";
import { cloneGraph, entry } from "../helpers";

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("link:status (M4, M13)", () => {
  it("marks data stale on silent and lost, clears it on live", () => {
    const { ctx } = createTestCtx();
    const hooks = createHandlers(ctx);
    const revision = ctx.state.view.revision;
    hooks["link:status"]({ status: { kind: "silent", since: 1, lastFrame: 1840 } });
    expect(ctx.state.data.stale).toBe(true);
    expect(ctx.state.data.staleFrame).toBe(1840);
    expect(ctx.state.view.revision).toBeGreaterThan(revision);
    hooks["link:status"]({
      status: { kind: "lost", reason: "game_reloaded", lastFrame: 1841, retryInMs: 1000 }
    });
    expect(ctx.state.data.staleFrame).toBe(1841);
    hooks["link:status"]({ status: { kind: "paused", frame: 1841 }, session: "s-1" });
    expect(ctx.state.data.stale).toBe(false);
    expect(ctx.state.data.staleFrame).toBeUndefined();
  });

  it("loads layout.json on the first live status of a session; the text-styles file is not read (D-66)", async () => {
    const { ctx, fakes } = createTestCtx({
      files: {
        ".moku/editor/layout.json":
          '{ "version": 1, "nodes": { "main/home": { "x": 0, "y": 0 } } }\n',
        "features/ui/styles.ts":
          'export const textStyles = defineTextStyles({\n  "ui.number": { size: 60 }\n});\n'
      },
      index: { "textStyle:ui.number": [{ path: "features/ui/styles.ts", line: 2 }] }
    });
    const hooks = createHandlers(ctx);
    hooks["link:status"]({ status: { kind: "live", frame: 1 }, session: "s-1" });
    await flush(10);
    expect(ctx.state.layout.pins.nodes["main/home"]).toEqual({ x: 0, y: 0 });
    expect(vi.mocked(fakes.files.read).mock.calls.map(([path]) => path)).not.toContain(
      "features/ui/styles.ts"
    );
    expect(fakes.palette.flat().map(item => item.group)).not.toContain("Styles");
    const reads = vi.mocked(fakes.files.read).mock.calls.length;
    hooks["link:status"]({ status: { kind: "live", frame: 2 }, session: "s-1" });
    await flush(5);
    expect(vi.mocked(fakes.files.read).mock.calls.length).toBe(reads);
    hooks["link:status"]({ status: { kind: "live", frame: 3 }, session: "s-2" });
    await flush(10);
    expect(vi.mocked(fakes.files.read).mock.calls.length).toBeGreaterThan(reads);
  });

  it("an expected reload (U9) marks no stale and keeps the last stale frame clear", () => {
    const { ctx } = createTestCtx();
    const hooks = createHandlers(ctx);
    hooks["link:status"]({ status: { kind: "live", frame: 1840 }, session: "s-1" });
    hooks["link:status"]({
      status: { kind: "lost", reason: "bye", lastFrame: 1840, retryInMs: 1000, reloading: true }
    });
    expect(ctx.state.data.stale).toBe(false);
    expect(ctx.state.data.staleFrame).toBeUndefined();
    expect(ctx.state.data.status.kind).toBe("lost");
  });

  it("a new session after a reload reads layout.json again; the same pins do not lay out again (B9)", async () => {
    const { ctx, fakes } = createTestCtx({
      files: {
        ".moku/editor/layout.json":
          '{ "version": 1, "nodes": { "main/home": { "x": 0, "y": 0 } } }\n'
      }
    });
    await prepare(ctx);
    const hooks = createHandlers(ctx);
    hooks["link:status"]({ status: { kind: "live", frame: 1 }, session: "s-1" });
    await flush(10);
    const result = ctx.state.layout.result;
    const relayout = vi.spyOn(actionsOf(ctx).layout, "relayout");
    const reads = vi.mocked(fakes.files.read).mock.calls.length;

    hooks["link:status"]({
      status: { kind: "lost", reason: "bye", lastFrame: 1, retryInMs: 1000, reloading: true }
    });
    hooks["link:status"]({ status: { kind: "live", frame: 2 }, session: "s-2" });
    await flush(10);
    expect(vi.mocked(fakes.files.read).mock.calls.length).toBeGreaterThan(reads);
    expect(relayout).not.toHaveBeenCalled();
    expect(ctx.state.layout.result).toBe(result);
  });

  it("logs a failed load as a warning", async () => {
    const { ctx, fakes } = createTestCtx();
    fakes.files.failing.set(".moku/editor/layout.json", new Error("boom"));
    createHandlers(ctx)["link:status"]({ status: { kind: "live", frame: 1 } });
    await flush(10);
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("empty clears the selection, the Back stack and the menu (M4)", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("board/merge");
    actions.focus.followEdge("main/board>board/merge:done");
    actions.focus.openMenu({ target: "canvas", key: undefined, outcome: undefined, x: 0, y: 0 });
    createHandlers(ctx)["link:status"]({ status: { kind: "empty" } });
    expect(ctx.state.focus.selected).toBeUndefined();
    expect(ctx.state.focus.back).toEqual([]);
    expect(ctx.state.focus.menu).toBeUndefined();
    expect(ctx.state.data.status.kind).toBe("empty");
  });
});

describe("workspace:changed", () => {
  it("marks Flow active and applies the default camera once (M11)", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const hooks = createHandlers(ctx);
    hooks["workspace:changed"]({ ws: "flow" });
    expect(ctx.state.view.active).toBe(true);
    expect(ctx.state.camera.initialised).toBe(true);
    expect(ctx.state.camera.cam.z).toBeGreaterThanOrEqual(0.8);
  });

  it("leaving Flow closes the context menu and cancels the tween", () => {
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { ctx } = createTestCtx();
    ctx.state.view.active = true;
    ctx.state.camera.anim = 7;
    actionsOf(ctx).focus.openMenu({
      target: "canvas",
      key: undefined,
      outcome: undefined,
      x: 0,
      y: 0
    });
    createHandlers(ctx)["workspace:changed"]({ ws: "files" });
    expect(ctx.state.view.active).toBe(false);
    expect(ctx.state.focus.menu).toBeUndefined();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(ctx.state.camera.anim).toBeUndefined();
  });
});

describe("intents of other views (R4)", () => {
  it("workspace:select-node shows Flow and selects; an unknown id warns", async () => {
    const { ctx, fakes } = createTestCtx();
    await prepare(ctx);
    const hooks = createHandlers(ctx);
    hooks["workspace:select-node"]({ id: "board/merge" });
    expect(fakes.workspace.show).toHaveBeenCalledWith("flow");
    expect(ctx.state.focus.selected).toBe("main/board>board/merge");
    hooks["workspace:select-node"]({ id: "board/nope" });
    expect(ctx.log.warn).toHaveBeenCalledWith("flowView:unknown-node", { id: "board/nope" });
    expect(ctx.state.focus.selected).toBe("main/board>board/merge");
  });

  it("workspace:focus-frame shows Flow and focuses the frame", async () => {
    const { ctx, fakes } = createTestCtx();
    await prepare(ctx);
    ctx.state.data.history = [entry(3, "board/merge", "rejected", { frame: 1778 })];
    createHandlers(ctx)["workspace:focus-frame"]({ frame: 1778 });
    expect(fakes.workspace.show).toHaveBeenCalledWith("flow");
    expect(ctx.state.focus.edge).toBe("main/board>board/merge:rejected");
  });
});

/** Starts the session watches and the hooks. */
function started(): TestCtx & { readonly hooks: ReturnType<typeof createHandlers> } {
  const test = createTestCtx();
  startFlowView(test.ctx);
  return { ...test, hooks: createHandlers(test.ctx) };
}

/** Delivers the three first values of the merge game. */
function sendData(test: TestCtx): void {
  test.fakes.send("game.graph", structuredClone(cloneGraph()));
  test.fakes.send("game.position", { path: "board/awaitIntent", waiting: ["tap"] });
  test.fakes.send("game.history", [entry(3, "board/merge", "rejected", { frame: 1778 })]);
}

describe("intents before the first flow values (Game is the default workspace)", () => {
  it("select-node shows Flow, waits for the graph, then selects without a warning", () => {
    const test = started();
    test.hooks["workspace:select-node"]({ id: "board/merge" });
    expect(test.fakes.workspace.show).toHaveBeenCalledWith("flow");
    expect(test.ctx.state.focus.selected).toBeUndefined();

    sendData(test);
    expect(test.ctx.state.focus.selected).toBe("main/board>board/merge");
    expect(test.ctx.log.warn).not.toHaveBeenCalled();
  });

  it("an unknown id still warns, once the graph is in", () => {
    const test = started();
    test.hooks["workspace:select-node"]({ id: "board/nope" });
    expect(test.ctx.log.warn).not.toHaveBeenCalled();
    sendData(test);
    expect(test.ctx.log.warn).toHaveBeenCalledWith("flowView:unknown-node", { id: "board/nope" });
  });

  it("focus-frame waits for the history, then focuses the edge at that frame", () => {
    const test = started();
    test.hooks["workspace:focus-frame"]({ frame: 1778 });
    expect(test.fakes.workspace.show).toHaveBeenCalledWith("flow");
    expect(test.fakes.workspace.toast).not.toHaveBeenCalled();

    sendData(test);
    expect(test.ctx.state.focus.edge).toBe("main/board>board/merge:rejected");
    expect(test.fakes.workspace.toast).toHaveBeenCalledWith("Frame 1778 · board/merge · rejected");
    expect(test.fakes.workspace.toast).not.toHaveBeenCalledWith(
      "Frames are not recorded in this history"
    );
  });

  it("the latest intent wins; an empty link drops it", () => {
    const test = started();
    test.hooks["workspace:focus-frame"]({ frame: 1778 });
    test.hooks["workspace:select-node"]({ id: "main/home" });
    sendData(test);
    expect(test.ctx.state.focus.selected).toBe("main/home");
    expect(test.ctx.state.focus.edge).toBeUndefined();

    const dropped = started();
    dropped.hooks["workspace:select-node"]({ id: "board/merge" });
    dropped.hooks["link:status"]({ status: { kind: "empty" } });
    sendData(dropped);
    expect(dropped.ctx.state.focus.selected).toBeUndefined();
  });
});

describe("workspace:density (finding 16)", () => {
  it("takes the applied density and lays out again with its ELK spacing; the same value does nothing", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const hooks = createHandlers(ctx);
    const relayout = vi.spyOn(actionsOf(ctx).layout, "relayout");
    hooks["workspace:density"]({ density: "compact" });
    expect(ctx.state.layout.density).toBe("compact");
    expect(relayout).toHaveBeenCalledTimes(1);
    hooks["workspace:density"]({ density: "compact" });
    expect(relayout).toHaveBeenCalledTimes(1);
    await flush(10);
    const compact = ctx.state.layout.result;
    hooks["workspace:density"]({ density: "comfortable" });
    await flush(10);
    const comfortable = ctx.state.layout.result;
    const width = (result: typeof compact): number => result?.byKey["#main"]?.w ?? 0;
    expect(width(compact)).toBeLessThan(width(comfortable));
  });
});

/** What a call throws. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("nothing was thrown");
}

describe("the link request node (D-60)", () => {
  it("before the first graph it throws the retryable no_graph error and keeps nothing for later", () => {
    const test = started();
    const error = thrown(() => answerNode(test.ctx)({ id: "board/merge" }));
    expect(error).toMatchObject({
      code: -32_003,
      message: "[moku-editor] the Flow view has no graph yet",
      data: { reason: "no_graph", retryable: true }
    });
    expect(isRetryable(error)).toBe(true);
    expect(test.ctx.state.data.pending).toBeUndefined();

    sendData(test);
    expect(test.ctx.state.focus.selected).toBeUndefined();
  });

  it("a known node id answers the item key it selected and the Inspector shows it", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    expect(answerNode(ctx)({ id: "board/merge" })).toEqual({
      id: "board/merge",
      selected: "main/board>board/merge"
    });
    expect(ctx.state.focus.selected).toBe("main/board>board/merge");
    expect(infoView(ctx, actionsOf(ctx), "board/merge")).toMatchObject({
      id: "board/merge",
      key: "main/board>board/merge"
    });
  });

  it("does not show Flow and warns nothing: the request has one job", async () => {
    const { ctx, fakes } = createTestCtx();
    await prepare(ctx);
    const node = answerNode(ctx);
    node({ id: "board/merge" });
    thrown(() => node({ id: "board/nope" }));
    expect(fakes.workspace.show).not.toHaveBeenCalled();
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("an unknown id throws -32602 invalid_input on the id field and keeps the selection", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const node = answerNode(ctx);
    node({ id: "main/home" });
    const error = thrown(() => node({ id: "board/nope" }));
    expect(error).toMatchObject({
      code: -32_602,
      message: "[moku-editor] unknown node board/nope",
      data: { reason: "invalid_input", retryable: false, field: "id" }
    });
    expect(isRetryable(error)).toBe(false);
    expect(ctx.state.focus.selected).toBe("main/home");
  });

  it("a node inside a collapsed sub-flow expands its parents and answers the key it gets", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    expect(ctx.state.layout.expanded.has("main/settings")).toBe(false);
    expect(answerNode(ctx)({ id: "settingsPopup/open" })).toEqual({
      id: "settingsPopup/open",
      selected: "main/settings>settingsPopup/open"
    });
    expect(ctx.state.layout.expanded.has("main/settings")).toBe(true);
    await flush(10);
    expect(ctx.state.layout.result?.byKey["main/settings>settingsPopup/open"]).toMatchObject({
      kind: "node",
      flow: "settingsPopup",
      parent: "main/settings"
    });
  });

  it("answers the asked id as selected when the focus reads no selection after the select", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    vi.spyOn(actionsOf(ctx).focus, "selected").mockReturnValue(undefined);
    expect(answerNode(ctx)({ id: "main/home" })).toEqual({
      id: "main/home",
      selected: "main/home"
    });
  });

  it("a select before the first canvas measure is framed by that measure, not the current node", async () => {
    const test = started();
    sendData(test);
    await flush(10);
    const { camera } = test.ctx.state;
    expect(camera.initialised).toBe(false);

    answerNode(test.ctx)({ id: "main/home" });
    expect(camera.frameSelection).toBe(true);

    actionsOf(test.ctx).camera.setView({ w: 1200, h: 800 });
    const home = test.ctx.state.layout.result?.byKey["main/home"];
    expect(camera.initialised).toBe(true);
    expect(camera.frameSelection).toBe(false);
    expect(((home?.x ?? 0) + (home?.w ?? 0) / 2) * camera.cam.z + camera.cam.x).toBeCloseTo(600, 0);
    expect(((home?.y ?? 0) + (home?.h ?? 0) / 2) * camera.cam.z + camera.cam.y).toBeCloseTo(400, 0);
  });

  it("on a measured canvas the select moves the camera itself: nothing waits for a measure", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    answerNode(ctx)({ id: "main/home" });
    expect(ctx.state.camera.frameSelection).toBe(false);
  });

  it("a node outside the entered sub-flow: the canvas goes back to the root, then it is selected", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.flows.enter("main/board");
    await flush(10);
    expect(actions.layout.root()).toBe("board");

    expect(answerNode(ctx)({ id: "main/home" })).toEqual({
      id: "main/home",
      selected: "main/home"
    });
    expect(actions.layout.root()).toBe("main");
    await flush(10);
    expect(ctx.state.focus.selected).toBe("main/home");
    expect(ctx.state.layout.result?.byKey["main/home"]).toMatchObject({
      kind: "node",
      id: "main/home"
    });
  });

  it("inside an entered sub-flow a node of it is selected there, and an id of no node is refused there", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.flows.enter("main/board");
    await flush(10);
    const node = answerNode(ctx);

    expect(node({ id: "board/merge" })).toMatchObject({ id: "board/merge" });
    const selected = ctx.state.focus.selected;
    expect(actions.layout.root()).toBe("board");

    expect(thrown(() => node({ id: "board/nope" }))).toMatchObject({
      code: -32_602,
      message: "[moku-editor] unknown node board/nope"
    });
    expect(actions.layout.root()).toBe("board");
    expect(ctx.state.focus.selected).toBe(selected);
  });
});
