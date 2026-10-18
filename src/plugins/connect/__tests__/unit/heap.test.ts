import { describe, expect, it } from "vitest";
import { heapSampleOf, inferGcs } from "../../cdp/heap";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 § 0.4: GCs are inferred from drops of usedSize ≥ gcDropMb between two
// CDP Runtime.getHeapUsage samples; freed MB = the drop.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Samples a second apart.
 *
 * @param used - usedMb of each.
 * @returns The samples.
 */
function samples(...used: number[]) {
  return used.map((usedMb, index) => ({ t: 1000 + index * 250, usedMb, totalMb: 64 }));
}

describe("inferGcs", () => {
  it("finds one GC in the sawtooth 27 → 57 → 31 MB at the drop's time", () => {
    expect(inferGcs(samples(27, 57, 31), 0.5)).toEqual([{ t: 1500, freedMb: 26, inferred: true }]);
  });

  it("sees no GC in a drop under gcDropMb, and never in a rise", () => {
    // Bug: every sample read as a GC.
    expect(inferGcs(samples(41, 40.6), 0.5)).toEqual([]);
    expect(inferGcs(samples(27, 31, 44, 57), 0.5)).toEqual([]);
    expect(inferGcs(samples(41, 40.5), 0.5)).toEqual([{ t: 1250, freedMb: 0.5, inferred: true }]);
  });

  it("finds a GC across two ticks from the last sample of the tick before", () => {
    const [first] = samples(31);
    if (first === undefined) throw new Error("samples");
    expect(inferGcs([first], 0.5, { t: 750, usedMb: 57, totalMb: 64 })).toEqual([
      { t: 1000, freedMb: 26, inferred: true }
    ]);
  });
});

describe("heapSampleOf", () => {
  it("reads Runtime.getHeapUsage bytes as MB, and nothing from another shape", () => {
    expect(heapSampleOf({ usedSize: 43_935_334, totalSize: 67_108_864 }, 9)).toEqual({
      t: 9,
      usedMb: 41.9,
      totalMb: 64
    });
    expect(heapSampleOf({ usedSize: "41" }, 9)).toBeUndefined();
    expect(heapSampleOf(undefined, 9)).toBeUndefined();
  });
});
