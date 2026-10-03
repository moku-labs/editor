// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { FIT_ALL, fitRect } from "../../camera/math";
import { createTestCtx, jumpCamera, prepare } from "../ctx";

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("camera api", () => {
  it("get returns a copy", async () => {
    const { ctx } = createTestCtx();
    const camera = actionsOf(ctx).camera;
    const cam = camera.get();
    cam.z = 9;
    expect(camera.get().z).toBe(1);
  });

  it("fitAll fits the root frame into the available rect", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const camera = actionsOf(ctx).camera;
    camera.fitAll();
    const result = ctx.state.layout.result;
    if (result === undefined) throw new Error("no layout");
    expect(camera.get()).toEqual(
      fitRect(
        result.bounds,
        { w: 1200, h: 800 },
        camera.insets(),
        FIT_ALL.pad,
        FIT_ALL.maxZ,
        ctx.config
      )
    );
  });

  it("leaves the strip and the preview column out of the available rect", async () => {
    const { ctx, fakes } = createTestCtx();
    const camera = actionsOf(ctx).camera;
    expect(camera.insets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    ctx.state.focus.strip = true;
    fakes.preview = { visible: true, size: "S", corner: "bottom-right", width: 150, height: 280 };
    expect(camera.insets()).toEqual({ top: 0, right: 224, bottom: 224, left: 0 });
    fakes.preview = { visible: true, size: "L", corner: "top-left", width: 340, height: 660 };
    expect(camera.insets()).toEqual({ top: 0, right: 0, bottom: 224, left: 364 });
    expect(ctx.state.camera.insets.left).toBe(364);
  });

  it("zoomBy and zoomTo zoom around the viewport centre and clamp", () => {
    const { ctx } = createTestCtx();
    ctx.state.camera.viewport = { w: 1000, h: 800 };
    const camera = actionsOf(ctx).camera;
    camera.zoomBy(1.25);
    expect(camera.get()).toEqual({ x: 500 - 500 * 1.25, y: 400 - 400 * 1.25, z: 1.25 });
    camera.zoomTo(1);
    expect(camera.get().z).toBeCloseTo(1, 9);
    camera.zoomBy(100);
    expect(camera.get().z).toBe(3);
  });

  it("follow toggles; only the toggle changes it (M9)", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    expect(actions.camera.follow()).toBe(true);
    const followed = actions.camera.get();
    expect(followed).not.toEqual({ x: 0, y: 0, z: 1 });
    actions.focus.select("board/merge");
    actions.focus.select(undefined);
    actions.camera.fitAll();
    expect(ctx.state.camera.follow).toBe(true);
    expect(actions.camera.follow(false)).toBe(false);
    expect(actions.camera.follow(false)).toBe(false);
  });

  it("applies the default camera once per root, never under 80 % (M11)", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const camera = actionsOf(ctx).camera;
    camera.applyDefault();
    expect(ctx.state.camera.initialised).toBe(true);
    expect(camera.get().z).toBeGreaterThanOrEqual(0.8);
    camera.panBy(50, 0);
    const moved = camera.get();
    camera.applyDefault();
    expect(camera.get()).toEqual(moved);
  });

  it("setView applies the default camera when Flow is active", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    ctx.state.view.active = true;
    actionsOf(ctx).camera.setView({ w: 900, h: 700 });
    expect(ctx.state.camera.viewport).toEqual({ w: 900, h: 700 });
    expect(ctx.state.camera.initialised).toBe(true);
  });

  it("runs input ops: pan, zoom at a point, zoomBy, zoomTo, fits", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const camera = actionsOf(ctx).camera;
    ctx.state.camera.cam = { x: 0, y: 0, z: 1 };
    camera.run({ kind: "pan", dx: 10, dy: -5 });
    expect(camera.get()).toMatchObject({ x: 10, y: -5 });
    camera.run({ kind: "zoom", px: 10, py: -5, factor: 2 });
    expect(camera.get()).toEqual({ x: 10, y: -5, z: 2 });
    camera.run({ kind: "zoomTo", z: 1 });
    expect(camera.get().z).toBeCloseTo(1, 9);
    camera.run({ kind: "zoomBy", factor: 0.8 });
    expect(camera.get().z).toBeCloseTo(0.8, 9);
    camera.run({ kind: "fit", target: "all" });
    actionsOf(ctx).focus.select("board/merge");
    camera.run({ kind: "fit", target: "selection" });
    expect(camera.get().z).toBeLessThanOrEqual(1.3);
    camera.centreOn(100, 100, false);
    const centred = camera.get();
    expect(100 * centred.z + centred.x).toBeCloseTo(600, 6);
  });
});
