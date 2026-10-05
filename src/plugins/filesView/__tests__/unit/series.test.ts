import { describe, expect, it } from "vitest";
import { isSeriesIndexPath, parseSeriesIndex, seriesSummary } from "../../preview/series";

// ─────────────────────────────────────────────────────────────────────────────
// The series index.json shape (gameView writes it): valid, wrong types, unknown
// fields, the path regex and the card summary
// ─────────────────────────────────────────────────────────────────────────────

const VALID = {
  label: "merge burst",
  durationMs: 3000,
  intervalMs: 250,
  fromFrame: 1841,
  shots: [
    { file: "shot-01.png", frame: 1841, atMs: 0 },
    { file: "shot-02.png", frame: 1856, atMs: 250, bug: true }
  ],
  device: { w: 390, h: 844 },
  stoppedEarly: true
};

describe("isSeriesIndexPath", () => {
  it("matches .moku/captures/series-*/index.json only", () => {
    expect(isSeriesIndexPath(".moku/captures/series-2026-09-24-1015/index.json")).toBe(true);
    expect(isSeriesIndexPath(".moku/captures/series-/index.json")).toBe(false);
    expect(isSeriesIndexPath(".moku/captures/series-a/b/index.json")).toBe(false);
    expect(isSeriesIndexPath("x/.moku/captures/series-a/index.json")).toBe(false);
    expect(isSeriesIndexPath(".moku/captures/shot/index.json")).toBe(false);
  });

  it("matches a series in a day folder (captures by day)", () => {
    expect(isSeriesIndexPath(".moku/captures/2026-10-05/series-1015/index.json")).toBe(true);
    expect(isSeriesIndexPath(".moku/captures/2026-10-05/series-1015-2/index.json")).toBe(true);
    expect(isSeriesIndexPath(".moku/captures/old/series-1015/index.json")).toBe(false);
    expect(isSeriesIndexPath(".moku/captures/2026-10-05/x/series-1015/index.json")).toBe(false);
  });
});

describe("parseSeriesIndex", () => {
  it("reads a valid index", () => {
    expect(parseSeriesIndex(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("ignores unknown fields and keeps optional ones out when absent", () => {
    const parsed = parseSeriesIndex(
      JSON.stringify({
        durationMs: 1000,
        intervalMs: 100,
        fromFrame: 3,
        shots: [{ file: "a.png", frame: 3, atMs: 0, extra: 1 }],
        owner: "me"
      })
    );
    expect(parsed).toEqual({
      durationMs: 1000,
      intervalMs: 100,
      fromFrame: 3,
      shots: [{ file: "a.png", frame: 3, atMs: 0 }]
    });
  });

  it.each([
    ["not json", "{"],
    ["an array", "[]"],
    ["a string duration", JSON.stringify({ ...VALID, durationMs: "3000" })],
    ["a missing interval", JSON.stringify({ ...VALID, intervalMs: undefined })],
    ["a label number", JSON.stringify({ ...VALID, label: 3 })],
    ["shots not an array", JSON.stringify({ ...VALID, shots: {} })],
    ["a shot without file", JSON.stringify({ ...VALID, shots: [{ frame: 1, atMs: 0 }] })],
    [
      "a shot bug string",
      JSON.stringify({ ...VALID, shots: [{ file: "a", frame: 1, atMs: 0, bug: "y" }] })
    ],
    ["stoppedEarly string", JSON.stringify({ ...VALID, stoppedEarly: "yes" })]
  ])("returns undefined for %s", (_label, text) => {
    expect(parseSeriesIndex(text)).toBeUndefined();
  });
});

describe("seriesSummary", () => {
  it("reads like the card line", () => {
    expect(seriesSummary(VALID, ".moku/captures/series-x/index.json")).toBe(
      "Series · merge burst · 2 shots · 3 s at 250 ms · from frame 1841 · stopped early"
    );
  });

  it("falls back to the folder name without a label and formats fractional seconds", () => {
    expect(
      seriesSummary(
        {
          durationMs: 2500,
          intervalMs: 250,
          fromFrame: 1841,
          shots: [{ file: "shot-01.png", frame: 1841, atMs: 0 }]
        },
        ".moku/captures/series-2026-09-24-1015/index.json"
      )
    ).toBe("Series · series-2026-09-24-1015 · 1 shot · 2.5 s at 250 ms · from frame 1841");
  });
});
