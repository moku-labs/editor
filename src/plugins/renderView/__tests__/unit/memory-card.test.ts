/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import { describe, expect, it } from "vitest";
import { gcsInRangeText, heapRangeLine, memoryBaselines } from "../../derive/memory";
import { pushSample } from "../../series/series";
import { createRenderViewState } from "../../state";
import { secondOf } from "../device-fixtures";
import { CONFIG } from "../helpers";
import { line, withEvents } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/memory.ts, the Memory card's lines (spec 09 § M9 Memory): the
// baselines follow the source rule (a device's CDP GCs, the local preview's GC
// events), the heap range is read over the view, and "In selection" counts the
// GCs of the range with the MB they freed.
// ─────────────────────────────────────────────────────────────────────────────

function mission() {
  return createRenderViewState({ config: CONFIG }).mission;
}

const TRUSTED = secondOf({
  memory: { heapMb: 20, source: "performance.memory", trusted: true, why: null, processMb: null }
});

describe("the Memory card's lines", () => {
  it("baselines on the local preview follow the GC events of the history", () => {
    const state = mission();
    for (const [t, mb] of [
      [1000, 30],
      [1300, 22],
      [1600, 21],
      [61_000, 40],
      [61_400, 23]
    ] as const)
      pushSample(state.series.heap, t, mb);
    withEvents(state.history, [line.gc(1200, null, 8), line.gc(61_100, null, 17)]);

    const baselines = memoryBaselines({
      second: TRUSTED,
      telemetry: undefined,
      series: state.series,
      history: state.history,
      device: false
    });

    expect(baselines).toEqual([
      { t: 1600, mb: 21 },
      { t: 61_400, mb: 23 }
    ]);
  });

  it("a device without a CDP heap has no baselines, even with GC events (the WebView heap is not trusted)", () => {
    const state = mission();
    pushSample(state.series.heap, 1300, 22);
    withEvents(state.history, [line.gc(1200, null, 8)]);

    expect(
      memoryBaselines({
        second: TRUSTED,
        telemetry: undefined,
        series: state.series,
        history: state.history,
        device: true
      })
    ).toEqual([]);
  });

  it("reads the heap range over the view only", () => {
    const state = mission();
    for (const [t, mb] of [
      [1000, 57],
      [5000, 27.4],
      [9000, 41]
    ] as const)
      pushSample(state.series.heap, t, mb);

    const text = (from: number, to: number) =>
      heapRangeLine(state.series.heap, from, to, "6 s")
        ?.map(part => (typeof part === "string" ? part : part.strong))
        .join("");
    expect(text(4000, 10_000)).toBe("Heap 27.4 → 41 MB over 6 s, GC marks on the shared axis");
    expect(text(20_000, 26_000)).toBeUndefined();
  });

  it("counts the GCs of a range with the MB they freed", () => {
    const state = mission();
    withEvents(state.history, [line.gc(1200, null, 4.2), line.gc(2200, null, 3.8)]);
    const input = {
      second: TRUSTED,
      telemetry: undefined,
      series: state.series,
      history: state.history,
      device: false
    };

    expect(gcsInRangeText(input, 1000, 3000)).toBe("2 GCs, freed 8 MB");
    expect(gcsInRangeText(input, 2000, 3000)).toBe("1 GC, freed 3.8 MB");
    expect(gcsInRangeText(input, 5000, 6000)).toBe("No GC");
  });
});
