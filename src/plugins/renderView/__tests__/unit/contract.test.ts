/* eslint-disable unicorn/no-null -- null is the wire's "GPU not measured" */
import { describe, expect, it } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import type { GraphContext2D, PerfWindow } from "../../device/contract";
import {
  createGraphState,
  createPerfWindow,
  meanGpu,
  paintGraph,
  readWireWindow,
  resetGraphText,
  rowAt,
  rowOfFrame,
  spikeAt
} from "../../device/contract";
import { SPIKE_FRAMES, windowWire, wireJson } from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The stand-ins of spec 03 the strip reads through device/contract until unit
// 03 lands: the wire window reader and its helpers, and the painter's layout
// and hit tests. (03's own suite replaces this file with the stand-ins.)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A context call that draws nothing the test reads.
 */
function nothing(): void {}

/**
 * A 2D context that records the texts it draws.
 *
 * @returns The context and its texts.
 */
function recordingContext(): { g: GraphContext2D; texts: string[] } {
  const texts: string[] = [];
  const g: GraphContext2D = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    fillRect: nothing,
    strokeRect: nothing,
    beginPath: nothing,
    closePath: nothing,
    moveTo: nothing,
    lineTo: nothing,
    fill: nothing,
    stroke: nothing,
    setLineDash: nothing,
    fillText: text => {
      texts.push(text);
    },
    measureText: text => ({ width: text.length * 6 })
  };
  return { g, texts };
}

/**
 * The demo window, read from the wire.
 *
 * @returns The window.
 */
function demoWindow(): PerfWindow {
  const window = createPerfWindow(1024);
  readWireWindow(wireJson(windowWire()), window);
  return window;
}

describe("createPerfWindow", () => {
  it("throws the two-line TypeError for a capacity that is not 1 to 65535 whole rows", () => {
    for (const capacity of [0, 70_000, 1.5]) {
      expect(() => createPerfWindow(capacity)).toThrow(
        new TypeError(
          `[moku-editor] createPerfWindow(${capacity}) needs a whole number of rows from 1 to 65535.\n  Pass perf's frames, for example 1024.`
        )
      );
    }
  });
});

describe("readWireWindow", () => {
  it("fills the rows: page-clock times, null GPU as NaN, the primary cause and the spike rows", () => {
    const window = createPerfWindow(1024);
    const wire = {
      ...windowWire(),
      gpuMs: windowWire().gpuMs.map((ms, index) => (index === 0 ? null : ms))
    };

    expect(readWireWindow(wireJson(wire), window)).toBe(true);
    expect(window.count).toBe(360);
    expect(window.t[1]).toBeCloseTo(40_016.67);
    expect(Number.isNaN(window.gpuMs[0])).toBe(true);
    expect(window.spikeCount).toBe(6);
    expect(window.frame[window.spikes[4] ?? 0]).toBe(4812);
    expect(window.cause[window.spikes[4] ?? 0]).toBe(2);
    expect(window.version).toBe(1);
  });

  it("refuses another version or unequal columns and leaves the window untouched", () => {
    const window = demoWindow();
    const wire = windowWire();

    expect(readWireWindow(toWireValue({ ...wire, v: 2 }), window)).toBe(false);
    expect(readWireWindow(wireJson({ ...wire, budgetMs: wire.budgetMs.slice(1) }), window)).toBe(
      false
    );
    expect(readWireWindow(wireJson({ ...wire, rateMs: wire.rateMs.slice(1) }), window)).toBe(false);
    expect(readWireWindow("nope", window)).toBe(false);
    expect(window.count).toBe(360);
    expect(window.version).toBe(1);
  });

  it("keeps the newest rows of a wire value longer than the window", () => {
    const window = createPerfWindow(4);
    readWireWindow(wireJson(windowWire(SPIKE_FRAMES, { count: 6, first: 4840 })), window);

    expect(window.count).toBe(4);
    expect([...window.frame]).toEqual([4842, 4843, 4844, 4845]);
    expect(window.spikeCount).toBe(1);
  });
});

describe("rowOfFrame and meanGpu", () => {
  it("finds a frame's row; −1 for a frame outside the window", () => {
    const window = demoWindow();

    expect(rowOfFrame(window, 4812)).toBe(326);
    expect(rowOfFrame(window, 4000)).toBe(-1);
  });

  it("averages the measured GPU of drawn rows; null when none is measured", () => {
    const window = demoWindow();
    expect(meanGpu(window)).toBeCloseTo(6);

    readWireWindow(wireJson(windowWire(SPIKE_FRAMES, { gpuTimer: false })), window);
    expect(meanGpu(window)).toBeNull();
  });
});

describe("paintGraph and the hit tests", () => {
  it("paints a flag per spike with its legend and records its hit box", () => {
    const window = demoWindow();
    const state = createGraphState(1024);
    const { g, texts } = recordingContext();

    paintGraph(g, window, { width: 1000, height: 200, wide: true, selected: -1 }, state);

    expect(state.flagCount).toBe(6);
    expect(texts).toEqual(
      expect.arrayContaining(["JS", "GPU", "SH", "GC? likely", "UP", "LF", "now"])
    );
    expect(texts).toContain("frame 4845, spike 6/6");
    const flag = 4;
    const x = ((state.flagX0[flag] ?? 0) + (state.flagX1[flag] ?? 0)) / 2;
    expect(spikeAt(state, window, x, 10)).toBe(326);
  });

  it("a tap near a spike bar finds it; elsewhere none; rowAt finds the row by time", () => {
    const window = demoWindow();
    const state = createGraphState(1024);
    paintGraph(
      recordingContext().g,
      window,
      { width: 1000, height: 200, wide: true, selected: 326 },
      state
    );
    const barX =
      state.px0 +
      (((window.t[326] ?? 0) - state.startMs + 8) / state.spanMs) * (state.px1 - state.px0);

    expect(spikeAt(state, window, barX, 150)).toBe(326);
    expect(spikeAt(state, window, state.px0 + 2, 150)).toBe(-1);
    expect(rowAt(state, window, state.px0)).toBe(0);
    expect(rowAt(state, window, state.px1 + 40)).toBe(359);
    expect(rowAt(state, createPerfWindow(4), 10)).toBe(-1);
  });

  it("reads SKIP for a skipped frame and labels a rate switch", () => {
    const window = createPerfWindow(16);
    const wire = windowWire([], { count: 4 });
    readWireWindow(
      wireJson({
        ...wire,
        drawn: [1, 1, 1, 0],
        rateMs: [16.67, 16.67, 8.33, 8.33],
        budgetMs: [16.67, 16.67, 8.33, 8.33]
      }),
      window
    );
    const { g, texts } = recordingContext();
    const state = createGraphState(16);
    resetGraphText(state);

    paintGraph(g, window, { width: 273, height: 108, wide: false, selected: -1 }, state);

    expect(texts).toContain("SKIP");
    expect(texts).toContain("120");
    expect(texts).toContain("8.3");
  });
});
