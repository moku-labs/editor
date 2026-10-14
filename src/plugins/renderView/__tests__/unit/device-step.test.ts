import { beforeEach, describe, expect, it } from "vitest";
import type { PerfWindow } from "../../device/contract";
import { createPerfWindow, readWireWindow } from "../../device/contract";
import { spikeCounter, stepFrom } from "../../device/step";
import { SPIKE_FRAMES, windowWire, wireJson } from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// device/step.ts: prev / next over the spikes of a window filled by
// readWireWindow, and the n/total counter; the selection is a frame number.
// ─────────────────────────────────────────────────────────────────────────────

let window: PerfWindow;

beforeEach(() => {
  window = createPerfWindow(1024);
  readWireWindow(wireJson(windowWire()), window);
});

describe("stepFrom", () => {
  it("next after the newest spike wraps to the oldest", () => {
    expect(stepFrom(window, 4812, 1)).toBe(4845);
    expect(stepFrom(window, 4845, 1)).toBe(4572);
  });

  it("previous before the oldest wraps to the newest", () => {
    expect(stepFrom(window, 4630, -1)).toBe(4572);
    expect(stepFrom(window, 4572, -1)).toBe(4845);
  });

  it("from no selection next takes the oldest and previous the newest", () => {
    expect(stepFrom(window, undefined, 1)).toBe(4572);
    expect(stepFrom(window, undefined, -1)).toBe(4845);
  });

  it("from a frame that is not a spike next takes the first spike after it", () => {
    expect(stepFrom(window, 4700, 1)).toBe(4701);
    expect(stepFrom(window, 4700, -1)).toBe(4630);
  });

  it("no spikes: nothing is selected and the counter reads 0/0", () => {
    readWireWindow(wireJson(windowWire([])), window);

    expect(stepFrom(window, undefined, 1)).toBeUndefined();
    expect(spikeCounter(window, undefined)).toBe("0/0");
  });
});

describe("spikeCounter", () => {
  it("a selected spike counts as its place", () => {
    expect(spikeCounter(window, 4812)).toBe("5/6");
  });

  it("a selected frame that is not a spike counts as '–/6'", () => {
    expect(spikeCounter(window, 4700)).toBe("–/6");
    expect(spikeCounter(window, undefined)).toBe("–/6");
  });

  it("a selection kept by frame number survives a window shift", () => {
    const shifted = SPIKE_FRAMES.map(spike => ({ ...spike }));
    readWireWindow(wireJson(windowWire(shifted, { first: 4500 })), window);

    expect(spikeCounter(window, 4812)).toBe("5/6");
    expect(stepFrom(window, 4812, 1)).toBe(4845);
  });
});
