// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { createHandlers } from "../../handlers";
import { startFlowView } from "../../lifecycle";
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

  it("loads layout.json and the style keys on the first live status of a session", async () => {
    const { ctx, fakes } = createTestCtx({
      files: {
        ".moku/editor/layout.json":
          '{ "version": 1, "nodes": { "main/home": { "x": 0, "y": 0 } } }\n',
        "features/ui/styles.ts":
          'export const textStyles = defineTextStyles({\n  "ui.number": { size: 60 }\n});\n'
      }
    });
    const hooks = createHandlers(ctx);
    hooks["link:status"]({ status: { kind: "live", frame: 1 }, session: "s-1" });
    await flush(10);
    expect(ctx.state.layout.pins.nodes["main/home"]).toEqual({ x: 0, y: 0 });
    expect(
      fakes.palette
        .flat()
        .filter(item => item.group === "Styles")
        .map(item => item.label)
    ).toEqual(["ui.number"]);
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
