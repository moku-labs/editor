// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatNote, newNote } from "../../../panels/shared/notes";
import { actionsOf } from "../../actions";
import { createHandlers } from "../../handlers";
import { createTestCtx, flush, jumpCamera, prepare } from "../ctx";
import { entry } from "../helpers";

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

  it("loads layout.json, the notes and the style keys on the first live status of a session", async () => {
    const { ctx, fakes } = createTestCtx({
      files: {
        ".moku/editor/layout.json":
          '{ "version": 1, "nodes": { "main/home": { "x": 0, "y": 0 } } }\n',
        ".moku/notes/2026-09-24-a.md": formatNote(newNote({ title: "A" })),
        "features/ui/styles.ts":
          'export const textStyles = defineTextStyles({\n  "ui.number": { size: 60 }\n});\n'
      }
    });
    const hooks = createHandlers(ctx);
    hooks["link:status"]({ status: { kind: "live", frame: 1 }, session: "s-1" });
    await flush(10);
    expect(ctx.state.layout.pins.nodes["main/home"]).toEqual({ x: 0, y: 0 });
    expect(ctx.state.notes.files.map(file => file.path)).toEqual([".moku/notes/2026-09-24-a.md"]);
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

  it("logs a failed load as a warning", async () => {
    const { ctx, fakes } = createTestCtx();
    fakes.files.failing.set(".moku/editor/layout.json", new Error("boom"));
    createHandlers(ctx)["link:status"]({ status: { kind: "live", frame: 1 } });
    await flush(10);
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("empty clears the selection and closes the strip, the menu and the editor (M4)", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.focus.select("main/home");
    actions.focus.openMenu({ target: "canvas", key: undefined, outcome: undefined, x: 0, y: 0 });
    actions.notes.edit({});
    createHandlers(ctx)["link:status"]({ status: { kind: "empty" } });
    expect(ctx.state.focus.selected).toBeUndefined();
    expect(ctx.state.focus.strip).toBe(false);
    expect(ctx.state.focus.menu).toBeUndefined();
    expect(ctx.state.notes.editor).toBeUndefined();
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
    expect(ctx.state.focus.edge).toBe("board/merge:rejected");
  });

  it("workspace:new-note shows Flow and opens the editor with the captures and the origin", () => {
    const { ctx, fakes } = createTestCtx();
    const hooks = createHandlers(ctx);
    hooks["workspace:new-note"]({
      captures: [".moku/captures/a.png"],
      from: { node: "board/merge" }
    });
    expect(fakes.workspace.show).toHaveBeenCalledWith("flow");
    expect(ctx.state.notes.editor?.captures).toEqual([".moku/captures/a.png"]);
    expect(ctx.state.notes.editor?.from).toEqual({ node: "board/merge" });
    hooks["workspace:new-note"]({});
    expect(ctx.state.notes.editor?.captures).toEqual([]);
  });
});
