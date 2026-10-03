// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  animateTo,
  applyCamera,
  cancelAnimation,
  DURATION,
  easeOutCubic,
  tween
} from "../../camera/animate";
import { subscribe } from "../../state";
import { createTestCtx } from "../ctx";

let frames: { id: number; callback: FrameRequestCallback }[];
let reduce = false;

beforeEach(() => {
  frames = [];
  reduce = false;
  let next = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = next++;
    frames.push({ id, callback });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames = frames.filter(frame => frame.id !== id);
  });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce") }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs the next queued frame at a time. */
function tick(time: number): void {
  const frame = frames.shift();
  frame?.callback(time);
}

describe("tween", () => {
  it("interpolates the zoom in log scale and the world centre linearly", () => {
    const view = { w: 1000, h: 800 };
    const from = { x: 500, y: 400, z: 0.5 };
    const to = { x: 500 - 1000 * 2, y: 400, z: 2 };
    const middle = tween(from, to, 0.5, view);
    expect(middle.z).toBeCloseTo(1, 9);
    const centre = { x: (500 - middle.x) / middle.z, y: (400 - middle.y) / middle.z };
    expect(centre.x).toBeCloseTo(500, 6);
    expect(centre.y).toBeCloseTo(0, 6);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 9);
  });
});

describe("animateTo", () => {
  it("moves over the duration (camera 420, zoom 200, follow 500) and lands on the target", () => {
    expect(DURATION).toEqual({ camera: 420, zoom: 200, follow: 500 });
    const { ctx } = createTestCtx();
    ctx.state.camera.viewport = { w: 1000, h: 800 };
    animateTo(ctx, { x: 100, y: 50, z: 2 }, DURATION.zoom);
    expect(ctx.state.camera.anim).toBeDefined();
    tick(1000);
    expect(ctx.state.camera.cam).toEqual({ x: 0, y: 0, z: 1 });
    tick(1100);
    expect(ctx.state.camera.cam.z).toBeGreaterThan(1);
    expect(ctx.state.camera.cam.z).toBeLessThan(2);
    tick(1200);
    expect(ctx.state.camera.cam).toEqual({ x: 100, y: 50, z: 2 });
    expect(ctx.state.camera.anim).toBeUndefined();
    expect(frames).toHaveLength(0);
  });

  it("a new move cancels the running one", () => {
    const { ctx } = createTestCtx();
    ctx.state.camera.viewport = { w: 1000, h: 800 };
    animateTo(ctx, { x: 100, y: 0, z: 1 }, 420);
    const first = ctx.state.camera.anim;
    animateTo(ctx, { x: -100, y: 0, z: 1 }, 420);
    expect(frames.map(frame => frame.id)).not.toContain(first);
    expect(frames).toHaveLength(1);
    cancelAnimation(ctx);
    expect(ctx.state.camera.anim).toBeUndefined();
    expect(frames).toHaveLength(0);
  });

  it("jumps with reduced motion", () => {
    reduce = true;
    const { ctx } = createTestCtx();
    animateTo(ctx, { x: 7, y: 8, z: 1.5 }, 420);
    expect(ctx.state.camera.cam).toEqual({ x: 7, y: 8, z: 1.5 });
    expect(frames).toHaveLength(0);
  });
});

describe("applyCamera", () => {
  it("writes the world transform and the grid, then notifies camera subscribers only", () => {
    const { ctx } = createTestCtx();
    const root = document.createElement("div");
    root.innerHTML = '<div data-flow="canvas"><div data-flow="world"></div></div>';
    ctx.state.view.root = root;
    ctx.state.camera.cam = { x: 10, y: 20, z: 0.5 };
    const data = vi.fn();
    const camera = vi.fn();
    subscribe(ctx.state, data);
    subscribe(ctx.state, camera, "camera");
    applyCamera(ctx);
    const world = root.querySelector<HTMLElement>('[data-flow="world"]');
    const canvas = root.querySelector<HTMLElement>('[data-flow="canvas"]');
    expect(world?.style.transform).toBe("translate(10px, 20px) scale(0.5)");
    expect(canvas?.style.backgroundSize).toBe("12px 12px");
    expect(canvas?.style.backgroundPosition).toBe("10px 20px");
    expect(camera).toHaveBeenCalledTimes(1);
    expect(data).not.toHaveBeenCalled();
  });
});
