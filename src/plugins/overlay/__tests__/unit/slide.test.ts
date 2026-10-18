// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { msToPx } from "../../../perf/graph";
import { openOverlay, setTab } from "../../modes";
import { SLIDE_TICKS, slideOffset } from "../../paint/slide";
import { overlayCss } from "../../styles";
import { PAINT_MS } from "../../types";
import { createOctx, part, started, stopped, type TestOctx, windowOf } from "../helpers";

// Delta 2026-10-15 (spec 08): the graph scrolls by one compositor slide per tick; paint stays
// at most 4 Hz.

let octx: TestOctx;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
  stopped(octx);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * A started card with the spy painter's slide distance.
 *
 * @param lead - What msToPx answers.
 * @returns The context.
 */
function card(lead = 10): TestOctx {
  octx = createOctx({ remember: false });
  octx.graph.lead = lead;
  started(octx);
  openOverlay(octx);
  return octx;
}

/**
 * The graph canvas.
 *
 * @returns The canvas.
 */
function canvas(): HTMLCanvasElement {
  return part<HTMLCanvasElement>(octx, "canvas");
}

/**
 * The fixed canvas.
 *
 * @returns The canvas.
 */
function fixed(): HTMLCanvasElement {
  return part<HTMLCanvasElement>(octx, "canvas[data-fixed]");
}

/**
 * A new window version, so the next tick paints.
 */
function changeWindow(): void {
  octx.perf.window = { ...octx.perf.window, version: octx.perf.window.version + 1 };
}

describe("the graph slide", () => {
  it("a first paint, painted two ticks wider, starts one tick behind the newest data and slides two ticks linearly up to it", () => {
    // Bug: the newest rows shown before they exist (a blank right edge), or no room to slide into.
    card(10);
    const w = octx.state.canvas?.w ?? 0;
    expect(canvas().style.getPropertyValue("transition")).toBe(
      `transform ${SLIDE_TICKS * PAINT_MS}ms linear`
    );
    expect(octx.state.slide).toMatchObject({ fromX: -5, toX: -10 });
    expect(canvas().style.getPropertyValue("transform")).toBe("translateX(-10px)");
    expect(canvas().style.getPropertyValue("width")).toBe(`${w + 10}px`);
    expect(octx.graph.paints.at(-1)).toMatchObject({ width: w + 10, lead: 10 });
  });

  it("the next paint carries on from where the graph is: no jump back to 0 (bug on the A26: the strip jumped every tick)", () => {
    card(10);
    vi.advanceTimersByTime(PAINT_MS - 1);
    const { edgeMs, toEdgeMs } = octx.state.slide;
    // Where the right edge is at the tick (PAINT_MS after the first paint).
    const timeBefore = edgeMs + ((toEdgeMs - edgeMs) * PAINT_MS) / (SLIDE_TICKS * PAINT_MS);
    // The data's end stepped unevenly: 40 ms more than one tick.
    octx.perf.window = {
      ...octx.perf.window,
      endMs: octx.perf.window.endMs + PAINT_MS + 40,
      version: octx.perf.window.version + 1
    };
    vi.advanceTimersByTime(1);
    // The same data time at the right edge just before and just after the paint.
    expect(octx.state.slide.edgeMs).toBeCloseTo(timeBefore, 6);
    // Never past the newest data.
    expect(octx.state.slide.toEdgeMs).toBeLessThanOrEqual(octx.perf.window.endMs);
  });

  it("a paint that comes late still finds the graph moving (the slide lasts two ticks)", () => {
    card(10);
    const at = slideOffset(octx.state, Date.now());
    vi.advanceTimersByTime(PAINT_MS + PAINT_MS / 2);
    expect(slideOffset(octx.state, Date.now())).toBeGreaterThan(at);
    expect(slideOffset(octx.state, Date.now())).toBeLessThan(10);
  });

  it("no extra paint between ticks: no animation frame, one timer, one paint a tick", () => {
    const frame = vi.spyOn(globalThis, "requestAnimationFrame");
    card(10);
    const before = octx.graph.paints.length;
    for (let tick = 0; tick < 4; tick += 1) {
      changeWindow();
      vi.advanceTimersByTime(PAINT_MS);
    }
    expect(octx.graph.paints.length - before).toBe(4);
    expect(vi.getTimerCount()).toBe(1);
    expect(frame).not.toHaveBeenCalled();
  });

  it("reduced motion starts none (the page's prefers-reduced-motion)", () => {
    vi.spyOn(globalThis, "matchMedia").mockImplementation(
      query => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList
    );
    card(10);
    expect(canvas().style.getPropertyValue("transition")).not.toContain("linear");
    expect(canvas().style.getPropertyValue("transform")).toBe("translateX(0px)");
    expect(octx.graph.paints.at(-1)?.lead).toBe(0);
  });

  it("reduced motion starts none (the game's reducedMotion)", () => {
    octx = createOctx({ remember: false });
    octx.graph.lead = 10;
    octx.registry.gameApp = { anim: { reducedMotion: () => true } };
    started(octx);
    openOverlay(octx);
    expect(canvas().style.getPropertyValue("transition")).not.toContain("linear");
    expect(octx.graph.paints.at(-1)?.lead).toBe(0);
  });

  it("a click mid-slide selects the frame under the pointer (the offset is added to the well x)", () => {
    card(10);
    octx.graph.hitRow = 4;
    vi.advanceTimersByTime(PAINT_MS / 2);
    canvas().dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 70 }));
    // From −5 px toward −10 px over two ticks: a quarter of the way.
    expect(octx.graph.hits.at(-1)).toBeCloseTo(106.25);
    expect(octx.state.selected).toBe(4807);
    vi.advanceTimersByTime(PAINT_MS * 2);
    canvas().dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 70 }));
    expect(octx.graph.hits.at(-1)).toBeCloseTo(110);
  });

  it("SLIDE_PX follows the scale (a shorter window slides further)", () => {
    octx = createOctx({ remember: false });
    Object.assign(octx.graph, { msToPx });
    started(octx);
    openOverlay(octx);
    const w = octx.state.canvas?.w ?? 0;
    const six = msToPx(octx.perf.window, w, false, SLIDE_TICKS * PAINT_MS);
    expect(canvas().style.getPropertyValue("width")).toBe(`${w + six}px`);
    octx.perf.window = { ...octx.perf.window, endMs: 3000, version: octx.perf.window.version + 1 };
    vi.advanceTimersByTime(PAINT_MS);
    const three = msToPx(octx.perf.window, w, false, SLIDE_TICKS * PAINT_MS);
    expect(three).toBeGreaterThan(six);
    expect(canvas().style.getPropertyValue("width")).toBe(`${w + three}px`);
  });
});

describe("the fixed canvas (tape, readout, now, caption, legend: it does not slide)", () => {
  it("is painted once a tick in the same visit, right after the plot, at the well's size, cleared first and never moved", () => {
    const order: string[] = [];
    octx = createOctx({ remember: false });
    octx.graph.lead = 10;
    const paint = octx.graph.paint;
    Object.assign(octx.graph, {
      paint: (...args: Parameters<typeof paint>) => {
        order.push(args[2].layer ?? "all");
        paint(...args);
      }
    });
    const read = octx.perf.readWindow;
    octx.perf.readWindow = visit => {
      order.push("visit");
      read(visit);
    };
    started(octx);
    openOverlay(octx);
    order.length = 0;
    for (let tick = 0; tick < 2; tick += 1) {
      changeWindow();
      vi.advanceTimersByTime(PAINT_MS);
    }
    const visits = order
      .join(" ")
      .split("visit")
      .map(group => group.trim())
      .filter(group => group !== "");
    expect(visits).toEqual(["plot fixed", "plot fixed"]);
    const w = octx.state.canvas?.w ?? 0;
    const h = octx.state.canvas?.h ?? 0;
    expect(octx.graph.fixedPaints.at(-1)).toMatchObject({ width: w, lead: 0, layer: "fixed" });
    expect(octx.graph.paints.at(-1)).toMatchObject({ width: w + 10, lead: 10, layer: "plot" });
    expect(octx.graph.clears.at(-1)).toEqual([0, 0, w, h]);
    expect(fixed().style.getPropertyValue("transform")).toBe("");
    expect(fixed().style.getPropertyValue("transition")).toBe("");
  });

  it("keeps its backing store across ticks (resized only on a size or dpr change)", () => {
    card(10);
    const w = octx.state.canvas?.w ?? 0;
    let size = fixed().width;
    let writes = 0;
    Object.defineProperty(fixed(), "width", {
      configurable: true,
      get: () => size,
      set: (value: number) => {
        writes += 1;
        size = value;
      }
    });
    for (let tick = 0; tick < 4; tick += 1) {
      changeWindow();
      vi.advanceTimersByTime(PAINT_MS);
    }
    expect([writes, size]).toEqual([0, w]);
  });

  it("covers the well and lets the pointer through", () => {
    const rule = /\[data-graph\] canvas\[data-fixed\]\s*\{([^}]*)\}/.exec(overlayCss)?.[1] ?? "";
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/left:\s*0/);
    expect(rule).toMatch(/top:\s*0/);
    expect(rule).toMatch(/pointer-events:\s*none/);
  });

  it("a click on the tape is read on the fixed canvas (bug: a row hidden under the tape mid-slide)", () => {
    card(10);
    const w = octx.state.canvas?.w ?? 0;
    const plot = octx.state.graph;
    const still = octx.state.fixedGraph;
    if (plot === undefined || still === undefined) throw new Error("no painter states");
    // The spy painter lays nothing out: the layouts of the phone's plot and fixed layers.
    plot.px1 = w + 10 - 36;
    still.px1 = w - 36;
    octx.graph.hitRow = 4;
    vi.advanceTimersByTime(PAINT_MS / 2);
    // Left of the tape: the plot, as far further right as it slid (−5 px toward −10 px, a quarter).
    canvas().dispatchEvent(new MouseEvent("click", { clientX: w - 36 - 6.25, clientY: 70 }));
    expect(octx.graph.hits.at(-1)).toBeCloseTo(w - 36);
    // On the tape: 5 px into it is 5 px past the plot's right edge, however far the plot slid.
    vi.advanceTimersByTime(PAINT_MS / 2);
    canvas().dispatchEvent(new MouseEvent("click", { clientX: w - 36 + 5, clientY: 70 }));
    expect(octx.graph.hits.at(-1)).toBeCloseTo(plot.px1 + 5);
  });

  it("is dropped with the plot (another tab) and comes back with it", () => {
    card(10);
    expect(octx.state.fixed?.element).toBe(fixed());
    setTab(octx, "record");
    expect(octx.state.fixed).toBeUndefined();
    expect(octx.state.fixedGraph).toBeUndefined();
    setTab(octx, "frames");
    expect(octx.state.fixed?.element).toBe(fixed());
  });
});

describe("the slide's bounds (review W3) and the pointer in the well (review I8)", () => {
  it("an empty window slides nothing (bug: startMs = endMs = 0 made a 59 000 px canvas)", () => {
    octx = createOctx({ remember: false });
    Object.assign(octx.graph, { msToPx });
    octx.perf.window = { ...windowOf([]), startMs: 0, endMs: 0 };
    started(octx);
    openOverlay(octx);
    const w = octx.state.canvas?.w ?? 0;
    expect(octx.graph.paints.at(-1)).toMatchObject({ width: w, lead: 0 });
    expect(canvas().style.getPropertyValue("transform")).toBe("translateX(0px)");
  });

  it("a slide never reaches past one well width (bug: a hostile window's scale sizing the canvas)", () => {
    card(100_000);
    const w = octx.state.canvas?.w ?? 0;
    expect(octx.graph.paints.at(-1)).toMatchObject({ width: 2 * w, lead: w });
    expect(canvas().style.getPropertyValue("transform")).toBe(`translateX(-${w}px)`);
  });

  it("a click is read from the well's padding box, inside its 1 px border (bug: every tap 1 px off)", () => {
    card(0);
    octx.graph.hitRow = 4;
    const well = canvas().parentElement;
    if (well === null) throw new Error("no well");
    vi.spyOn(well, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 50, 200, 90));
    Object.defineProperty(well, "clientLeft", { configurable: true, value: 1 });
    Object.defineProperty(well, "clientTop", { configurable: true, value: 1 });
    canvas().dispatchEvent(new MouseEvent("click", { clientX: 140, clientY: 120 }));
    expect(octx.graph.hits.at(-1)).toBe(39);
    expect(octx.state.probe.y).toBe(69);
  });
});
