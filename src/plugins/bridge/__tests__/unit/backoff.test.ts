import { describe, expect, it } from "vitest";
import { nextDelay } from "../../connection/backoff";
import { MAX_RETRY_MS } from "../../types";

describe("nextDelay", () => {
  it("doubles from retryMs up to the 30 s cap with random 0.5", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map(attempt => nextDelay(attempt, 1000, () => 0.5));

    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });

  it("jitters ±20 %: random 0 gives 0.8×, random 1 gives 1.2×", () => {
    expect(nextDelay(0, 1000, () => 0)).toBe(800);
    expect(nextDelay(0, 1000, () => 1)).toBe(1200);
    expect(nextDelay(2, 1000, () => 0)).toBe(3200);
  });

  it("applies the jitter to the capped delay", () => {
    expect(nextDelay(10, 1000, () => 0)).toBe(MAX_RETRY_MS * 0.8);
    expect(nextDelay(10, 1000, () => 1)).toBe(MAX_RETRY_MS * 1.2);
  });

  it("starts from a small retryMs and rounds to whole milliseconds", () => {
    expect(nextDelay(0, 100, () => 0.5)).toBe(100);
    expect(nextDelay(1, 100, () => 0.5)).toBe(200);
    expect(Number.isInteger(nextDelay(0, 333, () => 0.123))).toBe(true);
  });
});
