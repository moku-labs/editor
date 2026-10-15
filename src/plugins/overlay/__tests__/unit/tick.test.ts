// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../../handlers";
import { openOverlay } from "../../modes";
import { PAINT_MS } from "../../types";
import {
  type BracketMonitor,
  bracketMonitor,
  createOctx,
  pluginCtxOf,
  started,
  stopped,
  type TestOctx
} from "../helpers";

let octx: TestOctx;
let monitor: BracketMonitor;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  octx = createOctx({ remember: false });
  monitor = bracketMonitor();
  octx.perf.monitorValue = monitor;
  const paint = octx.graph.paint;
  Object.assign(octx.graph, {
    paint: (...args: Parameters<typeof paint>) => {
      monitor.calls.push("paint");
      paint(...args);
    }
  });
  const read = octx.perf.readWindow;
  octx.perf.readWindow = visit => {
    octx.perf.window.version += 1;
    read(visit);
  };
  started(octx);
});

afterEach(() => {
  stopped(octx);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Agent spans opened.
 *
 * @returns The begin count.
 */
function renders(): number {
  return monitor.calls.filter(call => call === "begin").length;
}

describe("the tick (cheapness)", () => {
  it("C4: an open card renders and paints at most 4 times a second with no input", () => {
    const frame = vi.spyOn(globalThis, "requestAnimationFrame");
    openOverlay(octx);
    const before = renders();
    vi.advanceTimersByTime(10_000);
    expect(renders() - before).toBe(40);
    expect(octx.graph.paints.length).toBeLessThanOrEqual(41);
    expect(octx.graph.paints.length).toBeGreaterThanOrEqual(40);
    expect(frame).not.toHaveBeenCalled();
  });

  it("C4: an unchanged window paints nothing (a paused game costs nothing)", () => {
    openOverlay(octx);
    octx.perf.readWindow = visit => {
      octx.perf.visitors.push(visit);
      visit(octx.perf.window);
    };
    const painted = octx.graph.paints.length;
    vi.advanceTimersByTime(PAINT_MS * 4);
    expect(octx.graph.paints).toHaveLength(painted);
  });

  it("C4: the backing store is resized only on a size or dpr change", () => {
    openOverlay(octx);
    const canvas = octx.state.canvas;
    if (canvas === undefined) throw new Error("no canvas");
    let width = canvas.element.width;
    let writes = 0;
    Object.defineProperty(canvas.element, "width", {
      configurable: true,
      get: () => width,
      set: (value: number) => {
        writes += 1;
        width = value;
      }
    });
    vi.advanceTimersByTime(PAINT_MS * 8);
    expect(writes).toBe(0);
    canvas.w = 300;
    vi.advanceTimersByTime(PAINT_MS);
    expect([writes, width]).toEqual([1, 300]);
    vi.advanceTimersByTime(PAINT_MS * 4);
    expect(writes).toBe(1);
  });

  it("C8: every render and paint sits between beginAgent and endAgent", () => {
    openOverlay(octx);
    vi.advanceTimersByTime(PAINT_MS * 3);
    let open = 0;
    for (const call of monitor.calls) {
      if (call === "begin") open += 1;
      if (call === "end") open -= 1;
      if (call === "paint") expect(open).toBeGreaterThan(0);
      expect(open).toBeGreaterThanOrEqual(0);
      expect(open).toBeLessThanOrEqual(1);
    }
    expect(open).toBe(0);
    expect(monitor.calls).toContain("paint");
  });

  it("a throwing render stops the tick (endAgent still runs; logged once)", () => {
    openOverlay(octx);
    octx.perf.second = () => {
      throw new Error("boom");
    };
    monitor.calls.length = 0;
    vi.advanceTimersByTime(PAINT_MS * 2);
    expect(monitor.calls).toEqual(["begin", "end", "begin", "end"]);
    expect(octx.state.tick).toBeDefined();
    expect(octx.log.warn).toHaveBeenCalledTimes(1);
    expect(octx.log.warn).toHaveBeenCalledWith("overlay:paint-failed", { message: "boom" });
  });

  it("C9: a hidden page stops the tick; visible restarts it", () => {
    openOverlay(octx);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(octx.state.tick).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(1);
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("data events between ticks do not render", () => {
    openOverlay(octx);
    const before = renders();
    createHandlers(pluginCtxOf(octx))["bridge:status"]({ status: { kind: "live", frame: 3 } });
    expect(renders()).toBe(before);
  });

  it("each tick builds a new visitor for perf.readWindow (the same two functions on every tick)", () => {
    openOverlay(octx);
    octx.perf.visitors.length = 0;
    vi.advanceTimersByTime(PAINT_MS * 5);
    expect(new Set(octx.perf.visitors)).toEqual(
      new Set([octx.visitors.count, octx.visitors.paint])
    );
  });

  it("the overlay keeps the window after the visitor returns (it never does)", () => {
    openOverlay(octx);
    vi.advanceTimersByTime(PAINT_MS * 3);
    expect(octx.state.facts.count).toBe(10);
    expect(octx.state.facts.total).toBe(3);
    const handed = new Set<unknown>(octx.perf.handed);
    const kept = Object.values(octx.state).some(value => handed.has(value));
    expect(kept).toBe(false);
    expect(octx.perf.handed.every(window => window.count === -1)).toBe(true);
  });
});
