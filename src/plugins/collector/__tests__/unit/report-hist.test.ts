import { describe, expect, it } from "vitest";
import { bucketUpper, histPercentile, parsePerfLog, summarize } from "../../report";
import { histOf, jsonl, sampleLine } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The fixed 81-bucket frame histogram: upper edges, nearest-rank percentiles
// and merged seconds.
// ─────────────────────────────────────────────────────────────────────────────

describe("bucketUpper", () => {
  it("maps the 1 ms buckets, the 5 ms buckets and the overflow bucket to their upper edges", () => {
    expect([0, 49, 50, 79, 80].map(index => bucketUpper(index))).toEqual([1, 50, 55, 200, 200]);
  });
});

describe("histPercentile", () => {
  it("answers the upper edge of a single bucket for every share", () => {
    const hist = histOf({ 8: 10 });

    expect(histPercentile(hist, 0.5)).toEqual({ ms: 9, over: false });
    expect(histPercentile(hist, 0.99)).toEqual({ ms: 9, over: false });
  });

  it("takes the nearest rank, ceil(share × total), on a bucket boundary", () => {
    const hist = histOf({ 0: 9, 1: 1 });

    expect(histPercentile(hist, 0.9)).toEqual({ ms: 1, over: false });
    expect(histPercentile(hist, 0.91)).toEqual({ ms: 2, over: false });
  });

  it("marks the 200 ms+ bucket as over", () => {
    expect(histPercentile(histOf({ 80: 5 }), 0.5)).toEqual({ ms: 200, over: true });
  });

  it("answers null for an empty histogram", () => {
    expect(histPercentile(histOf({}), 0.9)).toBeNull();
  });

  it("reads the merged seconds, never an average of per-second percentiles (bug: averaged p90s)", () => {
    const text = jsonl([
      sampleLine(1000, { frameHist: histOf({ 8: 100 }) }),
      sampleLine(2000, { frameHist: histOf({ 16: 100 }) })
    ]);

    const [screen] = summarize(parsePerfLog(text)).screens;

    // Per second the p90s are 9 and 17 (average 13); the merged 200 frames give 17.
    expect(screen?.p90).toEqual({ ms: 17, over: false });
    expect(screen?.p50).toEqual({ ms: 9, over: false });
    expect(screen?.frames).toBe(200);
  });
});
