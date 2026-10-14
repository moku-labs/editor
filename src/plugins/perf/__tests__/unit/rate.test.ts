import { describe, expect, it } from "vitest";
import { rateFps } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// rateFps: one frame of the loop's rate (the ring's rateMs) as frames a second.
// ─────────────────────────────────────────────────────────────────────────────

describe("rateFps", () => {
  it("reads 8.33 ms as 120 fps and 16.67 ms as 60 fps", () => {
    expect(rateFps(8.33)).toBe(120);
    expect(rateFps(16.67)).toBe(60);
  });

  it("answers 0 for a value that is not a finite number above 0 (a ring before rateMs)", () => {
    expect([0, -8.33, Number.NaN, Number.POSITIVE_INFINITY].map(value => rateFps(value))).toEqual([
      0, 0, 0, 0
    ]);
  });
});
