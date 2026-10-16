// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import type { GraphView } from "../../device/contract";
import { createGraphState, paintGraph } from "../../device/contract";
import { REPAINT_MS, STALE_AFTER_MS, type StripCanvas, startRepaint } from "../../device/paint";
import { onWorkspaceChanged } from "../../handlers";
import { startTracker } from "../../watch";
import { DEVICE, deviceSession, secondOf, windowWire, wireJson } from "../device-fixtures";
import {
  createCtx,
  GAME_01_SOURCES,
  type MotionQuery,
  manifestOf,
  type ResizeQueue,
  stubMotion,
  stubResizeObserver,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// device/paint.ts, spec 09 Amendment 2026-10-15: on the tools page the strip
// repaints on requestAnimationFrame with a moving now (since the Amendment
// 2026-10-16 a playout clock behind the newest row: device-playout.test.ts),
// over a static base layer redrawn only on a size, theme or scale change; the
// loop runs only while Render shows, the tab is visible and
// values arrive (2 s without one: it stops at the last frame); reduced motion
// keeps the 4 Hz steps. The painter is mocked: perf/graph owns its pixels.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../device/contract", async importOriginal => {
  const actual = await importOriginal<typeof import("../../device/contract")>();
  return { ...actual, paintGraph: vi.fn() };
});

let ctx: TestCtx;
let frames: (() => void)[];
let box: { width: number; height: number };
let motion: MotionQuery;
let sizes: ResizeQueue;
let rectReads: number;
let baseCanvas: StripCanvas & { drawn: number };

/**
 * A 2D context that accepts every call; `drawImage` and `setTransform` are recorded.
 *
 * @returns The context and its blits.
 */
function context() {
  const blits: unknown[] = [];
  const g = new Proxy(
    { measureText: () => ({ width: 10 }), drawImage: (...args: unknown[]) => blits.push(args) },
    { get: (target, key) => (key in target ? Reflect.get(target, key) : () => {}), set: () => true }
  );
  return { g, blits };
}

/**
 * The strip's canvas: a canvas element whose CSS box the test sets and whose layout reads it
 * counts, with the recording context.
 *
 * @returns The canvas.
 */
function canvasOf(): HTMLCanvasElement {
  const { g } = context();
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => {
    rectReads += 1;
    return box as DOMRect;
  };
  canvas.getContext = (() => g) as never;
  return canvas;
}

/**
 * The views paintGraph was asked for, by layer.
 *
 * @param layer - The layer.
 * @returns The views.
 */
function views(layer: GraphView["layer"]): GraphView[] {
  return vi
    .mocked(paintGraph)
    .mock.calls.map(call => call[2])
    .filter(view => (view.layer ?? "all") === layer);
}

/**
 * Runs the queued animation frames once.
 */
function runFrames(): void {
  const queue = frames;
  frames = [];
  for (const run of queue) run();
}

/**
 * Delivers one window value now.
 */
function deliverWindow(): void {
  ctx.link.send("editor.perf.window", wireJson(windowWire()));
}

/**
 * Starts the loop on the test canvas with the test's offscreen layer.
 *
 * @returns The cleanup.
 */
function start(): () => void {
  return startRepaint(ctx, canvasOf(), createGraphState(1024), () => baseCanvas as never);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"]
  });
  frames = [];
  box = { width: 1000, height: 200 };
  rectReads = 0;
  const base = context();
  baseCanvas = {
    width: 0,
    height: 0,
    drawn: 0,
    getBoundingClientRect: () => box,
    getContext: () => base.g as never
  };
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    frames.push(run);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  motion = stubMotion(false);
  sizes = stubResizeObserver();
  vi.stubGlobal("devicePixelRatio", 2);
  vi.mocked(paintGraph).mockReset();
  ctx = createCtx();
  ctx.link.api.sessions = () => [deviceSession("s-1", DEVICE)];
  ctx.link.api.session = () => "s-1";
  ctx.link.manifestValue = manifestOf([
    ...GAME_01_SOURCES,
    "editor.perf.second",
    "editor.perf.window"
  ]);
  startTracker(ctx);
  onWorkspaceChanged(ctx)({ ws: "render" });
});

afterEach(() => {
  ctx.state.device.stopPaint?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the interpolated loop", () => {
  it("starts with a value while Render shows and stops 2 s after the last value, at the last frame", () => {
    start();
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);
    expect(frames).toHaveLength(1);

    runFrames();
    runFrames();
    expect(views("over").length).toBeGreaterThanOrEqual(2);

    vi.advanceTimersByTime(STALE_AFTER_MS + 1);
    runFrames();
    const painted = vi.mocked(paintGraph).mock.calls.length;
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(REPAINT_MS * 4);
    runFrames();
    expect(vi.mocked(paintGraph).mock.calls.length).toBe(painted);
  });

  it("a hidden tab or a hidden Render stops the loop", () => {
    start();
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    runFrames();
    expect(frames).toHaveLength(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });

    vi.advanceTimersByTime(REPAINT_MS);
    expect(frames).toHaveLength(1);
    onWorkspaceChanged(ctx)({ ws: "flow" });
    runFrames();
    expect(frames).toHaveLength(0);
  });

  it("now runs with the clock behind the newest row and never past it (spec 09 Amendment 2026-10-16)", () => {
    start();
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);
    deliverWindow();
    const endMs = ctx.state.device.window.endMs;
    vi.advanceTimersByTime(100);
    runFrames();
    const moving = views("over").at(-1)?.nowMs ?? 0;
    vi.advanceTimersByTime(1000);
    runFrames();
    const capped = views("over").at(-1)?.nowMs ?? 0;

    expect(moving).toBeLessThan(endMs);
    expect(capped).toBeGreaterThan(moving);
    expect(capped).toBe(endMs);
  });

  it("the static base layer redraws only on a size, theme or scale change", () => {
    start();
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);
    runFrames();
    runFrames();
    runFrames();
    expect(views("base")).toHaveLength(1);
    expect(views("base")[0]?.look?.key).toBe("light");

    ctx.workspace.setTheme("dark");
    runFrames();
    expect(views("base")).toHaveLength(2);
    expect(views("over").at(-1)?.look?.key).toBe("dark");

    sizes.resize(800, 200);
    runFrames();
    vi.stubGlobal("devicePixelRatio", 1);
    runFrames();
    expect(views("base")).toHaveLength(4);
  });

  it("switching the editor theme repaints a stopped strip with the other palette", () => {
    start();
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);
    runFrames();
    vi.advanceTimersByTime(STALE_AFTER_MS + 1);
    runFrames();
    vi.mocked(paintGraph).mockClear();

    ctx.workspace.setTheme("dark");

    expect(views("base").at(-1)?.look?.key).toBe("dark");
    expect(views("over").at(-1)?.look?.key).toBe("dark");
  });

  it("reduced motion paints at most 4 times a second, in steps without a moving now", () => {
    motion.set(true);
    start();
    for (let tick = 0; tick < 20; tick += 1) {
      deliverWindow();
      ctx.link.send("editor.perf.second", toWireValue(secondOf()));
      vi.advanceTimersByTime(50);
    }
    runFrames();

    expect(frames).toHaveLength(0);
    expect(
      vi.mocked(paintGraph).mock.calls.filter(call => call[2].layer !== "base").length
    ).toBeLessThanOrEqual(4);
    expect(views("over").every(view => view.nowMs === undefined)).toBe(true);
  });

  it("turning reduced motion on stops the loop at the next frame, turning it off starts it again", () => {
    start();
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);
    expect(frames).toHaveLength(1);

    motion.set(true);
    runFrames();
    expect(frames).toHaveLength(0);

    motion.set(false);
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);
    expect(frames).toHaveLength(1);
  });
});

describe("a frame's cost (review W4)", () => {
  it("a frame reads no layout and asks no media query: the size comes from a ResizeObserver", () => {
    start();
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);
    const reads = rectReads;
    const queries = motion.calls();

    runFrames();
    runFrames();
    runFrames();

    expect(rectReads).toBe(reads);
    expect(motion.calls()).toBe(queries);
    expect(reads).toBeLessThanOrEqual(1);
    expect(queries).toBeLessThanOrEqual(1);

    sizes.resize(640, 180);
    runFrames();
    expect(views("over").at(-1)).toMatchObject({ width: 640, height: 180 });
    expect(rectReads).toBe(reads);
  });

  it("every frame paints with the same view object", () => {
    start();
    deliverWindow();
    vi.advanceTimersByTime(REPAINT_MS);

    runFrames();
    runFrames();
    runFrames();

    expect(views("over").length).toBeGreaterThanOrEqual(3);
    expect(new Set(views("over")).size).toBe(1);
  });

  it("the cleanup drops the size observer and the motion listener", () => {
    const stop = start();
    expect(sizes.observed()).toBe(1);
    expect(motion.listeners()).toBe(1);

    stop();

    expect(sizes.observed()).toBe(0);
    expect(motion.listeners()).toBe(0);
  });
});
