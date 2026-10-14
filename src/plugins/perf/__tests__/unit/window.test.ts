/* eslint-disable unicorn/no-null -- null is "not measured" on the wire */
import { describe, expect, it } from "vitest";
import type { Json } from "../../../registry/protocol";
import type { PerfWindow } from "../../protocol";
import {
  createPerfWindow,
  meanGpu,
  primaryCause,
  readWireWindow,
  rowOfFrame,
  spikeOrdinal,
  stepSpike,
  writeWireWindow
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/window: the window, its wire form and the readers the overlay and the
// tools strip share.
// ─────────────────────────────────────────────────────────────────────────────

/** One row of a test window. */
type Row = {
  frame: number;
  t: number;
  ms?: number;
  jsMs?: number;
  gpuMs?: number;
  rateMs?: number;
  budgetMs?: number;
  drawn?: 0 | 1;
  causes?: number;
};

/**
 * A window of the given rows, its cause codes and spike index computed like perf's reader.
 *
 * @param rows - The rows, oldest first.
 * @param capacity - The window's capacity.
 * @returns The window.
 */
function windowOf(rows: readonly Row[], capacity = 64): PerfWindow {
  const window = createPerfWindow(capacity);
  for (const [index, row] of rows.entries()) {
    window.frame[index] = row.frame;
    window.t[index] = row.t;
    window.ms[index] = row.ms ?? 16.7;
    window.jsMs[index] = row.jsMs ?? 3;
    window.gpuMs[index] = row.gpuMs ?? Number.NaN;
    window.rateMs[index] = row.rateMs ?? 16.67;
    window.budgetMs[index] = row.budgetMs ?? 16.67;
    window.drawn[index] = row.drawn ?? 1;
    window.causes[index] = row.causes ?? 0;
    window.cause[index] = primaryCause(row.causes ?? 0);
    if (window.cause[index] !== 0) {
      window.spikes[window.spikeCount] = index;
      window.spikeCount += 1;
    }
  }
  window.count = rows.length;
  window.startMs = (rows[0]?.t ?? 0) - 10;
  window.endMs = (rows.at(-1)?.t ?? 0) + 16.7;
  return window;
}

/** Five rows; rows 1 and 3 are spikes (gap, upload). */
const FIVE: readonly Row[] = [
  { frame: 10, t: 1000 },
  { frame: 11, t: 1016.7, causes: 0b1 },
  { frame: 12, t: 1033.4 },
  { frame: 13, t: 1050.1, causes: 0b1_0001 },
  { frame: 14, t: 1066.8 }
];

/** A valid wire value of two rows. */
const WIRE: Readonly<Record<string, Json>> = {
  v: 1,
  startMs: 40_123.5,
  endMs: 46_123.5,
  gpuTimer: true,
  frame: [4811, 4812],
  t: [5917.4, 5958.7],
  ms: [16.7, 41.3],
  jsMs: [3.4, 8],
  gpuMs: [5.2, null],
  rateMs: [8.33, 8.33],
  budgetMs: [8.33, 8.33],
  drawn: [1, 1],
  causes: [0, 17]
};

/**
 * The valid wire value with some fields replaced and one left out.
 *
 * @param overrides - Fields to replace.
 * @param without - A field to leave out.
 * @returns The wire value, a fresh copy.
 */
function wire(overrides: Readonly<Record<string, Json>> = {}, without = ""): Json {
  const value: Record<string, Json> = structuredClone({ ...WIRE, ...overrides });
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== without));
}

describe("stepSpike", () => {
  it("steps to the next and previous spike and wraps at both ends (prev/next stuck at the ends)", () => {
    const window = windowOf(FIVE);
    expect(stepSpike(window, 1, 1)).toBe(3);
    expect(stepSpike(window, 3, 1)).toBe(1);
    expect(stepSpike(window, 3, -1)).toBe(1);
    expect(stepSpike(window, 1, -1)).toBe(3);
  });

  it("from a row that is not a spike, takes the first spike after or the last before it", () => {
    const window = windowOf(FIVE);
    expect(stepSpike(window, 2, 1)).toBe(3);
    expect(stepSpike(window, 2, -1)).toBe(1);
  });

  it("answers -1 for a window without spikes", () => {
    expect(stepSpike(windowOf([{ frame: 1, t: 0 }]), 0, 1)).toBe(-1);
  });
});

describe("spikeOrdinal and rowOfFrame", () => {
  it("counts spikes from 1 and answers 0 for a plain row (the 5/6 counter)", () => {
    const window = windowOf(FIVE);
    expect([spikeOrdinal(window, 1), spikeOrdinal(window, 3), spikeOrdinal(window, 2)]).toEqual([
      1, 2, 0
    ]);
  });

  it("finds a frame's row and answers -1 for a frame outside the window", () => {
    const window = windowOf(FIVE);
    expect(rowOfFrame(window, 13)).toBe(3);
    expect([rowOfFrame(window, 9), rowOfFrame(window, 15)]).toEqual([-1, -1]);
  });
});

describe("meanGpu", () => {
  it("averages the measured GPU times of drawn rows only (bug: a GPU average of 0.0 on WebKit)", () => {
    const window = windowOf([
      { frame: 1, t: 0, gpuMs: 4 },
      { frame: 2, t: 16, gpuMs: 8 },
      { frame: 3, t: 32 },
      { frame: 4, t: 48, gpuMs: 30, drawn: 0 }
    ]);
    expect(meanGpu(window)).toBe(6);
  });

  it("answers null when no drawn row has a GPU time", () => {
    expect(meanGpu(windowOf([{ frame: 1, t: 0 }]))).toBeNull();
  });
});

describe("the wire form", () => {
  it("round-trips through writeWireWindow and readWireWindow with NaN GPU, rateMs and budgetMs (bug: a tools strip drawing the 16.7 line on a 120 fps phone)", () => {
    const source = windowOf([
      { frame: 7, t: 2000, gpuMs: 5.25, rateMs: 8.33, budgetMs: 8.33 },
      { frame: 8, t: 2008.3, rateMs: 16.67, budgetMs: 16.67, causes: 0b1_0001 },
      { frame: 9, t: 2025, drawn: 0 }
    ]);
    const value = writeWireWindow(source);
    expect(value.gpuMs).toEqual([5.25, null, null]);
    expect(value.drawn).toEqual([1, 1, 0]);
    expect(value.t).toEqual([10, 18.3, 35]);

    const into = createPerfWindow(16);
    expect(readWireWindow(value, into)).toBe(true);
    expect([...into.frame.subarray(0, 3)]).toEqual([7, 8, 9]);
    expect([...into.drawn.subarray(0, 3)]).toEqual([1, 1, 0]);
    expect(into.gpuMs[0]).toBeCloseTo(5.25);
    expect(Number.isNaN(into.gpuMs[1])).toBe(true);
    expect(into.rateMs[0]).toBeCloseTo(8.33, 2);
    expect(into.budgetMs[1]).toBeCloseTo(16.67, 2);
    expect(into.t[1]).toBeCloseTo(2008.3);
    expect([into.spikeCount, into.spikes[0], into.cause[1]]).toEqual([1, 1, 2]);
    expect(into.version).toBe(1);
  });

  it("refuses v: 2, unequal columns and a value without budgetMs, leaving the window untouched", () => {
    const into = createPerfWindow(16);
    for (const bad of [
      wire({ v: 2 }),
      wire({ ms: [16.7] }),
      wire({}, "budgetMs"),
      wire({ gpuTimer: "yes" }),
      wire({ rateMs: [8.33, "8.33"] }),
      [1, 2],
      null
    ]) {
      expect(readWireWindow(bad, into)).toBe(false);
    }
    expect([into.count, into.version]).toEqual([0, 0]);
  });

  it("refuses a span that is not finite or outside 0 < span ≤ 60 s (bug: a hostile phone value freezing the tools page)", () => {
    const into = createPerfWindow(16);
    expect(readWireWindow(wire({ endMs: 40_123.5 }), into)).toBe(false);
    expect(readWireWindow(wire({ endMs: 40_123.5 + 60_000.1 }), into)).toBe(false);
    expect(readWireWindow(wire({ startMs: -1e308, endMs: 1e308 }), into)).toBe(false);
    expect(readWireWindow(wire({ endMs: 40_123.5 + 60_000 }), into)).toBe(true);
  });

  it("drops cause bits it does not know and reads a bad causes item as no cause, never throwing", () => {
    const into = createPerfWindow(16);
    expect(readWireWindow(wire({ causes: [0b1001_0001, 1.5] }), into)).toBe(true);
    expect([into.causes[0], into.cause[0], into.causes[1], into.cause[1]]).toEqual([17, 2, 0, 0]);
    expect(readWireWindow(wire({ causes: [128, 300] }), into)).toBe(true);
    expect([into.spikeCount, into.causes[0], into.causes[1]]).toEqual([0, 0, 0]);
  });

  it("keeps the newest rows when the wire has more than the window's capacity", () => {
    const into = createPerfWindow(1);
    expect(readWireWindow(wire(), into)).toBe(true);
    expect([into.count, into.frame[0], into.ms[0]]).toEqual([1, 4812, Math.fround(41.3)]);
  });
});

describe("createPerfWindow", () => {
  it("refuses 0 and 65536 rows with the two-line TypeError (a window whose spikes index wraps)", () => {
    for (const capacity of [0, 65_536, 1.5]) {
      expect(() => createPerfWindow(capacity)).toThrow(TypeError);
    }
    expect(() => createPerfWindow(65_536)).toThrow(
      "[moku-editor] createPerfWindow(65536) needs a whole number of rows from 1 to 65535.\n  Pass perf's frames, for example 1024."
    );
    expect(createPerfWindow(65_535).capacity).toBe(65_535);
  });
});
