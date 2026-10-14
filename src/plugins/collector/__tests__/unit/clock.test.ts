/* eslint-disable unicorn/no-null -- null is "not measured" in the log lines and summaries */
import { describe, expect, it } from "vitest";
import { offsetWith, pageTime } from "../../session/clock";

// ─────────────────────────────────────────────────────────────────────────────
// One clock: the page-clock offset of a log is the max of t − rx (the line with
// the least delay), and a collector line gets t = now + offset.
// ─────────────────────────────────────────────────────────────────────────────

describe("offsetWith", () => {
  it("keeps the max of t − rx over the lines (bug: the mixed clocks of the game's log)", () => {
    let offset: number | null = null;
    offset = offsetWith(offset, 1000, 50_000);
    offset = offsetWith(offset, 2000, 50_900);
    offset = offsetWith(offset, 3000, 52_400);

    expect(offset).toBe(2000 - 50_900);
  });

  it("ignores a line without a finite t", () => {
    expect(offsetWith(null, undefined, 50_000)).toBeNull();
    expect(offsetWith(-100, Number.NaN, 50_000)).toBe(-100);
    expect(offsetWith(-100, "5", 50_000)).toBe(-100);
  });
});

describe("pageTime", () => {
  it("puts a computer moment on the page clock, rounded to 0.01 ms", () => {
    expect(pageTime(5917.4 - 1_791_986_090_000, 1_791_986_100_000)).toBe(15_917.4);
    expect(pageTime(-0.004, 10)).toBe(10);
    expect(pageTime(null, 1_791_986_100_000.123)).toBe(1_791_986_100_000.12);
  });
});
