// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openOverlay } from "../../modes";
import { PAINT_MS } from "../../types";
import { createOctx, part, started, stopped, type TestOctx, tenFrames } from "../helpers";

// Spec 03 delta item 8: perf marks a lone GPU outlier as noise and gives the window's GPU p50 and
// p90; the overlay's headline reads them (the mean only from an agent before the delta).

let octx: TestOctx;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  octx = createOctx({ remember: false });
});

afterEach(() => {
  stopped(octx);
  vi.useRealTimers();
});

describe("the GPU headline from the window", () => {
  it("reads the window's p50 and p90 (bug: a noisy frame moving the mean)", () => {
    octx.perf.window = { ...tenFrames(), gpuP50Ms: 4.2, gpuP90Ms: 6.8 };
    started(octx);
    openOverlay(octx);
    vi.advanceTimersByTime(PAINT_MS);
    expect(octx.state.facts).toMatchObject({ gpuP50: 4.2, gpuP90: 6.8 });
    expect(part(octx, '[data-counter="gpu"]').textContent).toBe("GPU p50 / p904.2 / 6.8ms");
  });

  it("keeps the mean of an agent before the delta, and nothing for a window without a GPU time", () => {
    started(octx);
    openOverlay(octx);
    vi.advanceTimersByTime(PAINT_MS);
    expect(octx.state.facts).toMatchObject({ gpuAvg: 6, gpuP50: undefined, gpuP90: undefined });
    octx.perf.window = { ...tenFrames(2), gpuP50Ms: Number.NaN, gpuP90Ms: Number.NaN };
    vi.advanceTimersByTime(PAINT_MS);
    expect(octx.state.facts).toMatchObject({
      gpuAvg: undefined,
      gpuP50: undefined,
      gpuP90: undefined
    });
    expect(part(octx, '[data-counter="gpu"] b').textContent).toBe("\u2014no timer");
  });
});
