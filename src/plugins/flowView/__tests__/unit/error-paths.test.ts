// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { actionsOf } from "../../actions";
import { createTestCtx, flush, jumpCamera, prepare } from "../ctx";
import { fixtureText } from "../helpers";

const STYLES = "features/ui/styles.ts";
const LAYOUT = ".moku/editor/layout.json";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("style write failures", () => {
  it("shows a failed write without the prefix, and a reload that did not restore", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { ctx, fakes } = createTestCtx({ files: { [STYLES]: fixtureText("ui-styles.txt") } });
    const inspector = actionsOf(ctx).inspector;
    await inspector.openStyles("ui.number");
    vi.mocked(fakes.files.write).mockRejectedValueOnce(
      new Error("[moku-editor] forbidden path: x")
    );
    inspector.stepStyle("size", 1, false);
    await vi.advanceTimersByTimeAsync(600);
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(ctx.state.inspector.styles?.result).toEqual({ ok: false, text: "! forbidden path: x" });

    fakes.reload.mockResolvedValueOnce({ restored: false, reason: "no_session" });
    inspector.stepStyle("size", 1, false);
    inspector.stepStyle("strokeWidth", 1, false);
    await vi.advanceTimersByTimeAsync(600);
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(fakes.files.writes.length).toBeGreaterThanOrEqual(2);
    expect(fakes.reload).toHaveBeenCalled();
  });

  it("a missing style key is no-op; a read failure of the keys clears the palette group", async () => {
    const { ctx, fakes } = createTestCtx();
    const inspector = actionsOf(ctx).inspector;
    inspector.stepStyle("size", 1, false);
    inspector.selectStyle("ui.number");
    fakes.files.failing.set(STYLES, new Error("boom"));
    await inspector.readStyleKeys();
    expect(ctx.log.debug).toHaveBeenCalled();
    expect(await inspector.usedBy("ui.number")).toEqual([]);
    fakes.link.read.mockResolvedValueOnce([
      { key: "coins", local: { textStyle: "ui.number" } },
      { name: "x", local: { textStyle: "ui.title" } }
    ]);
    expect(await inspector.usedBy("ui.number")).toEqual(["coins"]);
    fakes.link.read.mockRejectedValueOnce(new Error("no session"));
    expect(await inspector.usedBy("ui.number")).toEqual([]);
  });
});

describe("layout failures", () => {
  it("a non-conflict write error toasts 'Layout not saved'; an invalid file on conflict turns read-only", async () => {
    jumpCamera();
    const { ctx, fakes } = createTestCtx({
      config: { layoutSaveDelayMs: 0 },
      files: { [LAYOUT]: '{ "version": 1 }\n' }
    });
    await prepare(ctx);
    const layout = actionsOf(ctx).layout;
    await layout.loadPins();
    vi.mocked(fakes.files.write).mockRejectedValueOnce(
      wireError(-32_004, "[moku-editor] forbidden path: x")
    );
    const origin = ctx.state.layout.result?.origins["#main|main"] ?? { x: 0, y: 0 };
    layout.drop("main/home", origin.x + 12, origin.y + 12);
    await flush(10);
    expect(fakes.workspace.toast).toHaveBeenCalledWith(
      "Layout not saved · forbidden path: x",
      LAYOUT
    );

    fakes.files.store.set(LAYOUT, { text: "{ broken", version: "disk" });
    layout.drop("main/home", origin.x + 24, origin.y + 24);
    await flush(10);
    expect(ctx.state.layout.pinsReadOnly).toBe(true);

    layout.drop("main/board", 0, 0);
    layout.drop("nope", 0, 0);
    layout.dropNote("a.md", "nowhere", 0, 0);
    expect(ctx.state.layout.pins.notes["a.md"]).toBeUndefined();
  });

  it("a read error other than a missing file propagates from loadPins; collapse of a missing key is harmless", async () => {
    jumpCamera();
    const { ctx, fakes } = createTestCtx();
    await prepare(ctx);
    fakes.files.failing.set(LAYOUT, new Error("socket closed"));
    await expect(actionsOf(ctx).layout.loadPins()).rejects.toThrow("socket closed");
    actionsOf(ctx).flows.collapse("nope");
    actionsOf(ctx).flows.enter("main/home");
    actionsOf(ctx).flows.up(5);
    expect(actionsOf(ctx).layout.root()).toBe("main");
  });
});

describe("notes failures", () => {
  it("a note that cannot be read is skipped with a warning; attach rethrows a second conflict", async () => {
    const path = ".moku/notes/2026-09-24-a.md";
    const { ctx, fakes } = createTestCtx({ files: { [path]: "---\ntitle: A\n---\n" } });
    fakes.files.failing.set(path, new Error("boom"));
    await actionsOf(ctx).notes.load();
    expect(ctx.log.warn).toHaveBeenCalled();
    fakes.files.failing.clear();
    fakes.files.conflicts = 2;
    await expect(actionsOf(ctx).notes.attach(path, ["a.png"])).rejects.toThrow("version conflict");
    actionsOf(ctx).notes.update({ title: "x" });
    expect(ctx.state.notes.editor).toBeUndefined();
  });
});
