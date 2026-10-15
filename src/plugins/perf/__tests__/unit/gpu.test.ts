import { describe, expect, it } from "vitest";
import type { PerfWindowView } from "../../protocol";
import {
  CAUSE_BITS,
  createPerfWindow,
  GPU_BIT,
  isGpuNoise,
  primaryCause,
  promoteSustainedGpu,
  REST,
  spreadGpu
} from "../../protocol";
import type { WindowRow } from "../helpers";
import { windowOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/gpu: the GPU noise rule of spec 03 delta item 8 — a GPU over budget
// counts only when sustained (2 of 3 consecutive drawn frames); a lone outlier
// stays a faint GPU tick — and the window's GPU p50/p90.
// ─────────────────────────────────────────────────────────────────────────────

/** A drawn row with a lone over-budget GPU, not counted yet. */
const OUTLIER: Omit<WindowRow, "t"> = { gpuMs: 22, noise: 0b100 };

/** The JS cause bit. */
const JS_BIT = 1 << CAUSE_BITS.indexOf("js");

/**
 * Rows 16.7 ms apart, each given row merged in.
 *
 * @param rows - The rows' own values, oldest first.
 * @returns The window.
 */
function rowsOf(rows: readonly Omit<WindowRow, "t">[]) {
  return windowOf(rows.map((row, index) => ({ gpuMs: 0.5, ...row, t: index * 16.7 })));
}

describe("GPU_BIT", () => {
  it("is the engine's gpu cause bit (CAUSE_BITS order)", () => {
    expect(GPU_BIT).toBe(1 << CAUSE_BITS.indexOf("gpu"));
  });
});

describe("promoteSustainedGpu", () => {
  it("leaves a lone GPU outlier as noise, not a spike (bug: one 17-25 ms reading on Apple/Mali flagged as a GPU spike)", () => {
    const window = rowsOf([{}, {}, OUTLIER, {}, {}, {}]);
    expect(promoteSustainedGpu(window)).toBe(false);
    expect([window.noise[2], window.causes[2], window.cause[2]]).toEqual([GPU_BIT, 0, 0]);
  });

  it("counts a GPU over budget on 2 of 3 consecutive drawn frames, both frames (next to each other)", () => {
    const window = rowsOf([{}, OUTLIER, OUTLIER, {}]);
    expect(promoteSustainedGpu(window)).toBe(true);
    for (const row of [1, 2]) {
      expect([window.noise[row], window.causes[row], window.cause[row]]).toEqual([
        0,
        GPU_BIT,
        primaryCause(GPU_BIT)
      ]);
    }
  });

  it("counts two over-budget GPU frames with one drawn frame between (2 of 3)", () => {
    const window = rowsOf([OUTLIER, {}, OUTLIER]);
    expect(promoteSustainedGpu(window)).toBe(true);
    expect([window.cause[0], window.cause[1], window.cause[2]]).toEqual([1, 0, 1]);
  });

  it("leaves two over-budget GPU frames three drawn frames apart as noise (never 2 of any 3)", () => {
    const window = rowsOf([OUTLIER, {}, {}, OUTLIER]);
    expect(promoteSustainedGpu(window)).toBe(false);
    expect([window.noise[0], window.noise[3], window.cause[0], window.cause[3]]).toEqual([
      GPU_BIT,
      GPU_BIT,
      0,
      0
    ]);
  });

  it("counts drawn frames only: frames not drawn between two outliers do not separate them", () => {
    const window = rowsOf([OUTLIER, { drawn: 0 }, { drawn: 0 }, { drawn: 0 }, OUTLIER]);
    expect(promoteSustainedGpu(window)).toBe(true);
    expect([window.cause[0], window.cause[4]]).toEqual([1, 1]);
  });

  it("pairs a new outlier with a GPU it already counted (the second result promotes the first, not twice)", () => {
    const window = rowsOf([{ gpuMs: 22, causes: GPU_BIT, cause: 1 }, {}, OUTLIER]);
    expect(promoteSustainedGpu(window)).toBe(true);
    expect([window.cause[0], window.cause[2], window.noise[2]]).toEqual([1, 1, 0]);
    expect(promoteSustainedGpu(window)).toBe(false);
  });

  it("keeps a JS spike's cause JS while its GPU is noise, and ranks GPU first once sustained", () => {
    const lone = rowsOf([{}, { ...OUTLIER, causes: JS_BIT }, {}, {}]);
    promoteSustainedGpu(lone);
    expect([lone.cause[1], lone.noise[1]]).toEqual([primaryCause(JS_BIT), GPU_BIT]);

    const sustained = rowsOf([{}, { ...OUTLIER, causes: JS_BIT }, OUTLIER]);
    promoteSustainedGpu(sustained);
    expect([sustained.cause[1], sustained.causes[1]]).toEqual([
      primaryCause(GPU_BIT),
      GPU_BIT | JS_BIT
    ]);
  });

  it("never makes a resting frame a spike when its GPU is counted", () => {
    const window = rowsOf([OUTLIER, { ...OUTLIER, rest: REST.idle }]);
    promoteSustainedGpu(window);
    expect([window.cause[0], window.cause[1], window.causes[1]]).toEqual([1, 0, GPU_BIT]);
  });
});

describe("isGpuNoise", () => {
  it("answers whether a row's GPU was a lone outlier; false for a window without the noise column", () => {
    const window = rowsOf([{}, OUTLIER]);
    expect([isGpuNoise(window, 0), isGpuNoise(window, 1), isGpuNoise(window, 7)]).toEqual([
      false,
      true,
      false
    ]);
    const withoutNoise: PerfWindowView = { ...window };
    Reflect.deleteProperty(withoutNoise, "noise");
    expect(isGpuNoise(withoutNoise, 1)).toBe(false);
  });
});

describe("spreadGpu", () => {
  it("writes the p50 and p90 GPU time of the drawn frames with a measured GPU (nearest rank)", () => {
    const rows = Array.from({ length: 10 }, (_row, index) => ({ gpuMs: 10 - index }));
    const window = rowsOf([...rows, { gpuMs: 99, drawn: 0 }, { gpuMs: Number.NaN }]);
    spreadGpu(window);
    expect([window.gpuP50Ms, window.gpuP90Ms]).toEqual([5, 9]);
  });

  it("writes NaN for a window without a measured GPU time (no GPU timer)", () => {
    const window = rowsOf([{ gpuMs: Number.NaN }, { gpuMs: Number.NaN }]);
    spreadGpu(window);
    expect([window.gpuP50Ms, window.gpuP90Ms]).toEqual([Number.NaN, Number.NaN]);
  });

  it("is NaN in a new window", () => {
    const window = createPerfWindow(4);
    expect([window.gpuP50Ms, window.gpuP90Ms]).toEqual([Number.NaN, Number.NaN]);
  });
});
