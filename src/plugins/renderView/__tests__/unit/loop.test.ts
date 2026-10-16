// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushSample } from "../../series/series";
import type { PerfSecond } from "../../source/contract";
import { appendFrames } from "../../source/contract";
import { notifyMission } from "../../state";
import { paintFrames } from "../../timeline/frames";
import { paintedScene, startLoop } from "../../timeline/loop";
import { readPalette } from "../../timeline/palette";
import { paintSpark, SPARK_MARK } from "../../timeline/spark";
import { noteArrival } from "../../view/clock";
import { setHover } from "../../view/hover";
import { secondOf } from "../device-fixtures";
import { createCtx, type MotionQuery, stubMotion, type TestCtx } from "../helpers";
import { line, rowsOf, wireOf, withEvents } from "../mission-fixtures";
import { PALETTE } from "../paint-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// timeline/loop.ts (spec 09 § M11 "The rAF loop"): one requestAnimationFrame
// loop paints every canvas of the workspace; a canvas repaints only when its
// key changed; the live view moves while frames arrive and the loop sleeps once
// the clock eased to a stop; a cursor move, new data or a resize wakes it; the
// backing store follows the size and dpr with the transform set before every
// paint; the palette is read once per theme; stop releases everything. The
// painters are mocked: their pixels are timeline/*'s tests.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../timeline/frames", async original => ({
  ...(await original<typeof import("../../timeline/frames")>()),
  paintFrames: vi.fn()
}));
vi.mock("../../timeline/spark", async original => ({
  ...(await original<typeof import("../../timeline/spark")>()),
  paintSpark: vi.fn()
}));
vi.mock("../../timeline/palette", async original => ({
  ...(await original<typeof import("../../timeline/palette")>()),
  readPalette: vi.fn(() => PALETTE)
}));

let ctx: TestCtx;
let root: HTMLElement;
let queued: Map<number, FrameRequestCallback>;
let handle: number;
let motion: MotionQuery;
let observers: Set<FakeObserver>;
let stop: (() => void) | undefined;

/** A ResizeObserver whose entries name their canvas. */
class FakeObserver {
  readonly callback: ResizeObserverCallback;
  readonly targets = new Set<Element>();
  disconnected = false;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.add(this);
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.disconnected = true;
    this.targets.clear();
  }
}

/** The context each canvas hands out: the transform and the clears are recorded. */
function contextOf() {
  return { setTransform: vi.fn(), clearRect: vi.fn() };
}

/** A canvas of the root with a fixed box. */
function canvasOf(
  paint: string,
  spark?: string
): HTMLCanvasElement & { g: ReturnType<typeof contextOf> } {
  const canvas = document.createElement("canvas") as HTMLCanvasElement & {
    g: ReturnType<typeof contextOf>;
  };
  canvas.dataset.paint = paint;
  if (spark !== undefined) canvas.dataset.spark = spark;
  canvas.g = contextOf();
  canvas.getContext = (() => canvas.g) as never;
  canvas.getBoundingClientRect = () => ({ width: 1000, height: 262 }) as DOMRect;
  root.append(canvas);
  return canvas;
}

/** Runs the queued animation frames once. */
function runFrame(): void {
  const run = [...queued.values()];
  queued.clear();
  for (const callback of run) callback(performance.now());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance", "Date"] });
  queued = new Map();
  handle = 0;
  observers = new Set();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    handle += 1;
    queued.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queued.delete(id);
  });
  vi.stubGlobal("ResizeObserver", FakeObserver);
  vi.stubGlobal("devicePixelRatio", 2);
  motion = stubMotion(false);
  vi.mocked(paintFrames).mockClear();
  vi.mocked(paintSpark).mockClear();
  vi.mocked(readPalette).mockClear();
  ctx = createCtx();
  appendFrames(ctx.state.mission.history, wireOf(rowsOf(4800, 120)));
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  root.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the paint loop", () => {
  it("paints a canvas when its key changed and nothing in a frame where nothing did", () => {
    canvasOf("timeline");
    stop = startLoop(ctx, root);
    runFrame();
    expect(paintFrames).toHaveBeenCalledTimes(1);

    runFrame();
    expect(paintFrames).toHaveBeenCalledTimes(1);
    expect(queued.size).toBe(0);

    ctx.state.mission.selectionVersion += 1;
    notifyMission(ctx.state.mission);
    expect(queued.size).toBe(1);
    runFrame();
    expect(paintFrames).toHaveBeenCalledTimes(2);
  });

  it("moves the live view every frame while frames arrive and sleeps once the clock eased to a stop", () => {
    canvasOf("timeline");
    const { mission } = ctx.state;
    noteArrival(mission.clock, 12_000, performance.now());
    stop = startLoop(ctx, root);
    runFrame();
    const ends: number[] = [];
    for (let frame = 0; frame < 10; frame += 1) {
      vi.advanceTimersByTime(16);
      runFrame();
      ends.push(paintedScene(mission)?.endMs ?? 0);
    }
    expect(vi.mocked(paintFrames).mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(ends.every((end, index) => index === 0 || end > (ends[index - 1] ?? 0))).toBe(true);

    vi.advanceTimersByTime(4000);
    runFrame();
    runFrame();
    expect(queued.size).toBe(0);
  });

  it("wakes on a cursor move and paints the cursor there", () => {
    canvasOf("timeline");
    stop = startLoop(ctx, root);
    runFrame();
    runFrame();
    expect(queued.size).toBe(0);

    setHover(ctx.state.mission, 11_000, 4860);
    expect(queued.size).toBe(1);
    runFrame();
    expect(paintFrames).toHaveBeenCalledTimes(2);
  });

  it("sizes the backing store to the box at the dpr and sets the transform before each paint", () => {
    const canvas = canvasOf("spark", "frame");
    stop = startLoop(ctx, root);
    runFrame();
    expect([canvas.width, canvas.height]).toEqual([2000, 524]);
    expect(canvas.g.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    expect(paintSpark).toHaveBeenCalledTimes(1);

    const [observer] = observers;
    observer?.callback(
      [{ target: canvas, contentRect: { width: 400, height: 46 } }] as never,
      observer as never
    );
    runFrame();
    expect([canvas.width, canvas.height]).toEqual([800, 92]);
    expect(paintSpark).toHaveBeenCalledTimes(2);
  });

  it("reads the palette again after a theme change, not on every frame", () => {
    canvasOf("timeline");
    stop = startLoop(ctx, root);
    runFrame();
    expect(readPalette).toHaveBeenCalledTimes(1);

    notifyMission(ctx.state.mission);
    runFrame();
    expect(readPalette).toHaveBeenCalledTimes(1);

    ctx.workspace.themeValue = "dark";
    notifyMission(ctx.state.mission);
    runFrame();
    expect(readPalette).toHaveBeenCalledTimes(2);
    expect(paintFrames).toHaveBeenCalledTimes(3);
  });

  it("reads the palette once per theme and source kind across starts: a restart reuses it, another kind reads its own", () => {
    // Bug: every start of the loop (each mount, each time Render is shown) resolving the 20 tokens
    // again through getComputedStyle.
    canvasOf("timeline");
    root.dataset.src = "local";
    stop = startLoop(ctx, root);
    runFrame();
    stop();
    stop = startLoop(ctx, root);
    runFrame();
    expect(readPalette).toHaveBeenCalledTimes(1);

    root.dataset.src = "device";
    notifyMission(ctx.state.mission);
    runFrame();
    expect(readPalette).toHaveBeenCalledTimes(2);

    root.dataset.src = "local";
    notifyMission(ctx.state.mission);
    runFrame();
    expect(readPalette).toHaveBeenCalledTimes(2);
  });

  it("hands the Memory sparkline its GC marks and, while Leak?, the baseline trend, and the GPU passes one its compile marks", () => {
    // Bug: the cards' diamonds and trend never reaching their canvases.
    const memory = canvasOf("spark", "memory");
    const gpu = canvasOf("spark", "gpu");
    const { mission } = ctx.state;
    mission.second = secondOf({
      memory: {
        heapMb: 31,
        source: "performance.memory",
        trusted: true,
        why: null,
        processMb: null
      }
    } as Partial<PerfSecond>);
    withEvents(mission.history, [
      line.gc(11_000, null, 4),
      line.shader(11_500, 4890, "fog.blur", 31),
      line.gc(41_000, null, 4),
      line.gc(71_000, null, 4)
    ]);
    for (const [t, mb] of [
      [11_200, 30],
      [41_200, 30.9],
      [71_200, 31.8]
    ] as const)
      pushSample(mission.series.heap, t, mb);

    stop = startLoop(ctx, root);
    runFrame();

    const calls = vi.mocked(paintSpark).mock.calls;
    const memoryCall = calls.find(call => call[0] === (memory.g as never));
    const gpuCall = calls.find(call => call[0] === (gpu.g as never));
    expect(memoryCall?.[2].marks.includes(SPARK_MARK.gc)).toBe(true);
    expect((memoryCall?.[3].trend?.perMs ?? 0) * 60_000).toBeCloseTo(1.8, 4);
    expect(gpuCall?.[2].marks.includes(SPARK_MARK.compile)).toBe(true);
    expect(gpuCall?.[3].trend).toBeUndefined();
  });

  it("finds a canvas added by a render after a notification, and drops one that left", () => {
    canvasOf("timeline");
    stop = startLoop(ctx, root);
    runFrame();
    const spark = canvasOf("spark", "fps");
    notifyMission(ctx.state.mission);
    runFrame();
    expect(paintSpark).toHaveBeenCalledTimes(1);

    spark.remove();
    notifyMission(ctx.state.mission);
    runFrame();
    const [observer] = observers;
    expect(observer?.targets.has(spark)).toBe(false);
  });

  it("stop cancels the queued frame and releases the observers and the listeners", () => {
    canvasOf("timeline");
    const listeners = ctx.state.mission.listeners.size;
    stop = startLoop(ctx, root);
    expect(queued.size).toBe(1);
    expect(motion.listeners()).toBe(1);

    stop();
    stop();
    expect(queued.size).toBe(0);
    expect(motion.listeners()).toBe(0);
    expect([...observers].every(observer => observer.disconnected)).toBe(true);
    expect(ctx.state.mission.listeners.size).toBe(listeners);
    expect(paintedScene(ctx.state.mission)).toBeUndefined();
    setHover(ctx.state.mission, 11_000, 4860);
    expect(queued.size).toBe(0);
  });
});
