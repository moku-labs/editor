// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import { createGraphState, paintGraph } from "../../device/contract";
import { REPAINT_MS, type StripCanvas, startRepaint } from "../../device/paint";
import { onWorkspaceChanged } from "../../handlers";
import { startTracker } from "../../watch";
import { DEVICE, deviceSession, secondOf, windowWire, wireJson } from "../device-fixtures";
import { createCtx, GAME_01_SOURCES, manifestOf, stubFrames, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// device/paint.ts: the ≤ 4 Hz repaint loop of the strip's canvas through the
// painter (mocked here: 03 owns its pixels) — only after a new value, never
// while Render is hidden, the transform set before each paint, the backing
// store resized only on a size or dpr change, no timer after the cleanup.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../../device/contract", async importOriginal => {
  const actual = await importOriginal<typeof import("../../device/contract")>();
  return { ...actual, paintGraph: vi.fn() };
});

/**
 * A settle function before the promise gave its own.
 */
function stopLater(): void {}

let ctx: TestCtx;
let calls: string[];
let box: { width: number; height: number };
let widthWrites: number;

/**
 * A strip canvas whose context records the transform and whose backing store counts its writes.
 *
 * @returns The canvas.
 */
function fakeCanvas(): StripCanvas {
  const g = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 10 }),
    setTransform: vi.fn((...args: number[]) => {
      calls.push(`setTransform ${args.join(",")}`);
    })
  };
  let width = 0;
  return {
    get width() {
      return width;
    },
    set width(value: number) {
      widthWrites += 1;
      width = value;
    },
    height: 0,
    getBoundingClientRect: () => box,
    getContext: () => g
  };
}

/**
 * Delivers one perf value to the device watches (a new value for the painter).
 */
function deliver(): void {
  ctx.link.send("editor.perf.second", toWireValue(secondOf()));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("devicePixelRatio", 2);
  calls = [];
  box = { width: 1000, height: 200 };
  widthWrites = 0;
  vi.mocked(paintGraph).mockReset();
  vi.mocked(paintGraph).mockImplementation(() => {
    calls.push("paint");
  });
  ctx = createCtx();
  ctx.link.api.sessions = () => [deviceSession("s-1", DEVICE)];
  ctx.link.api.session = () => "s-1";
  ctx.link.manifestValue = manifestOf([
    ...GAME_01_SOURCES,
    "editor.perf.second",
    "editor.perf.window",
    "editor.perf.spikes"
  ]);
  stubFrames();
  startTracker(ctx);
  onWorkspaceChanged(ctx)({ ws: "render" });
  ctx.state.device.dirty = false;
});

afterEach(() => {
  ctx.state.device.stopPaint?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the repaint loop", () => {
  it("no paint without a new value", () => {
    startRepaint(ctx, fakeCanvas(), createGraphState(1024));

    vi.advanceTimersByTime(REPAINT_MS * 4);

    expect(paintGraph).not.toHaveBeenCalled();
  });

  it("three values within 250 ms paint once", () => {
    startRepaint(ctx, fakeCanvas(), createGraphState(1024));

    deliver();
    vi.advanceTimersByTime(100);
    deliver();
    ctx.link.send("editor.perf.window", wireJson(windowWire()));
    vi.advanceTimersByTime(REPAINT_MS - 100);
    vi.advanceTimersByTime(REPAINT_MS * 2);

    expect(paintGraph).toHaveBeenCalledTimes(1);
  });

  it("no paint while Render is hidden", () => {
    startRepaint(ctx, fakeCanvas(), createGraphState(1024));
    onWorkspaceChanged(ctx)({ ws: "flow" });
    ctx.state.device.dirty = true;

    vi.advanceTimersByTime(REPAINT_MS * 4);

    expect(paintGraph).not.toHaveBeenCalled();
  });

  it("the transform is set before every paint", () => {
    startRepaint(ctx, fakeCanvas(), createGraphState(1024));

    deliver();
    vi.advanceTimersByTime(REPAINT_MS);
    deliver();
    vi.advanceTimersByTime(REPAINT_MS);

    expect(calls).toEqual([
      "setTransform 2,0,0,2,0,0",
      "paint",
      "setTransform 2,0,0,2,0,0",
      "paint"
    ]);
    expect(vi.mocked(paintGraph).mock.calls[0]?.[2]).toEqual({
      width: 1000,
      height: 200,
      wide: true,
      selected: -1
    });
  });

  it("the backing store is resized only on a size or dpr change", () => {
    const canvas = fakeCanvas();
    startRepaint(ctx, canvas, createGraphState(1024));

    deliver();
    vi.advanceTimersByTime(REPAINT_MS);
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(400);
    deliver();
    vi.advanceTimersByTime(REPAINT_MS);
    expect(widthWrites).toBe(1);

    box = { width: 800, height: 200 };
    deliver();
    vi.advanceTimersByTime(REPAINT_MS);
    expect(widthWrites).toBe(2);
    expect(canvas.width).toBe(1600);
  });

  it("paints once more when Barlow Condensed has loaded, with the legends measured again", async () => {
    let loaded: () => void = stopLater;
    const load = vi.fn(
      () =>
        new Promise<void>(resolve => {
          loaded = resolve;
        })
    );
    vi.stubGlobal(
      "document",
      Object.assign(Object.create(document), { fonts: { load, ready: new Promise(() => {}) } })
    );
    const graph = createGraphState(1024);
    startRepaint(ctx, fakeCanvas(), graph);
    ctx.link.send("editor.perf.window", wireJson(windowWire()));
    vi.advanceTimersByTime(REPAINT_MS);
    graph.measured = true;

    loaded();
    await vi.advanceTimersByTimeAsync(REPAINT_MS);

    expect(load).toHaveBeenCalledWith('600 12px "Barlow Condensed"');
    expect(paintGraph).toHaveBeenCalledTimes(2);
    expect(graph.measured).toBe(false);
  });

  it("the cleanup leaves no interval, also when onStop runs it", () => {
    const stop = startRepaint(ctx, fakeCanvas(), createGraphState(1024));
    expect(vi.getTimerCount()).toBe(2);

    stop();
    expect(vi.getTimerCount()).toBe(0);

    startRepaint(ctx, fakeCanvas(), createGraphState(1024));
    ctx.state.device.stopPaint?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
