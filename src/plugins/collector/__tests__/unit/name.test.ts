import { describe, expect, it } from "vitest";
import { fileNameOf } from "../../session/name";

// ─────────────────────────────────────────────────────────────────────────────
// fileNameOf: perf-<yyyymmdd-hhmm>-<model>.jsonl, slugged, never a taken name.
// ─────────────────────────────────────────────────────────────────────────────

/** 2026-10-14 15:32 local time. */
const AT = new Date(2026, 9, 14, 15, 32, 7);

describe("fileNameOf", () => {
  it("names a log by the local minute and the lower-cased model", () => {
    expect(fileNameOf(AT, "SM-A266B", () => false)).toBe("perf-20261014-1532-sm-a266b.jsonl");
    expect(fileNameOf(new Date(2026, 0, 2, 3, 4), "X", () => false)).toBe(
      "perf-20260102-0304-x.jsonl"
    );
  });

  it("adds -2, -3 … to a name taken on disk or by another session (bug: two phones writing one file)", () => {
    const taken = new Set([
      "perf-20261014-1532-sm-a266b.jsonl",
      "perf-20261014-1532-sm-a266b-2.jsonl"
    ]);

    expect(fileNameOf(AT, "SM-A266B", name => taken.has(name))).toBe(
      "perf-20261014-1532-sm-a266b-3.jsonl"
    );
  });

  it("slugs a model with slashes or spaces, trims dashes, keeps at most 40 characters", () => {
    expect(fileNameOf(AT, " Pixel 8 Pro/US ", () => false)).toBe(
      "perf-20261014-1532-pixel-8-pro-us.jsonl"
    );
    expect(fileNameOf(AT, `${"A".repeat(39)}/B`, () => false)).toBe(
      `perf-20261014-1532-${"a".repeat(39)}.jsonl`
    );
    expect(fileNameOf(AT, "//", () => false)).toBe("perf-20261014-1532-device.jsonl");
  });
});
