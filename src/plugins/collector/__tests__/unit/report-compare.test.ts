/* eslint-disable unicorn/no-null -- null is "not measured" in a summary */
import { describe, expect, it } from "vitest";
import type { LogSummary, ScreenSummary } from "../../report";
import { compare, compareText } from "../../report";

// ─────────────────────────────────────────────────────────────────────────────
// compare: A/B by screen and rate, ▲/▼ at ±10 % of A, spikes per minute.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A screen row: one minute of garden/boss at 120.
 *
 * @param overrides - Fields to change.
 * @returns The row.
 */
function screen(overrides: Partial<ScreenSummary> = {}): ScreenSummary {
  return {
    path: "garden/boss",
    rate: 120,
    seconds: 60,
    frames: 7200,
    p50: { ms: 9, over: false },
    p90: { ms: 100, over: false },
    p99: { ms: 25, over: false },
    gpuMs: 4.8,
    spikes: 10,
    spikesPerMin: 10,
    causes: [["js", 10]],
    passes: 6,
    textureMb: { art: 96, targets: 32, kept: 6 },
    heapMb: 151,
    poolTrims: { count: 0, freedMb: 0 },
    warmUps: { count: 0, draws: 0 },
    overlays: [],
    ...overrides
  };
}

/**
 * A log summary of rows.
 *
 * @param screens - The rows.
 * @returns The summary.
 */
function summaryOf(...screens: ScreenSummary[]): LogSummary {
  return {
    device: { model: "SM-A266B", backend: "webgpu", engine: null, build: null },
    seconds: screens.reduce((sum, row) => sum + row.seconds, 0),
    screens,
    heat: [],
    system: [],
    marks: [],
    rateSwitches: [],
    lost: 0,
    lines: 0,
    skipped: { notJson: 0, noVersion: 0, otherVersion: 0, unknownKind: 0, badShape: 0 }
  };
}

describe("compare", () => {
  it("draws no arrow at −9 % and +9 %, and one at ±10 % (the threshold)", () => {
    const base = summaryOf(screen());
    const pctOf = (ms: number) =>
      compare(base, summaryOf(screen({ p90: { ms, over: false } }))).rows[0]?.p90;

    expect(pctOf(91)).toEqual({ a: 100, b: 91, pct: -9, arrow: null });
    expect(pctOf(109)).toEqual({ a: 100, b: 109, pct: 9, arrow: null });
    expect(pctOf(90)).toEqual({ a: 100, b: 90, pct: -10, arrow: "▼" });
    expect(pctOf(110)).toEqual({ a: 100, b: 110, pct: 10, arrow: "▲" });
  });

  it("marks 0 → 3 spikes per minute as worse", () => {
    const { rows } = compare(
      summaryOf(screen({ spikes: 0, spikesPerMin: 0 })),
      summaryOf(screen({ spikes: 3, spikesPerMin: 3 }))
    );

    expect(rows[0]?.spikesPerMin).toEqual({ a: 0, b: 3, pct: null, arrow: "▲" });
    expect(rows[0]?.worse).toEqual(["spikes"]);
  });

  it("gives a screen of one log only null values on the other side and no arrow", () => {
    const { rows } = compare(summaryOf(screen()), summaryOf(screen({ path: "shop" })));

    expect(rows.map(row => [row.path, row.p99.a, row.p99.b, row.p99.arrow])).toEqual([
      ["garden/boss", 25, null, null],
      ["shop", null, 25, null]
    ]);
  });

  it("compares spikes per minute, so a log twice as long with the same rate has no arrow", () => {
    const { rows } = compare(
      summaryOf(screen({ seconds: 60, spikes: 10, spikesPerMin: 10 })),
      summaryOf(screen({ seconds: 120, spikes: 20, spikesPerMin: 10 }))
    );

    expect(rows[0]?.spikesPerMin.arrow).toBeNull();
    expect(rows[0]?.worse).toEqual([]);
  });

  it("lists only the ▲ metrics in worse, and sorts rows by path, then rate from high to low", () => {
    const a = summaryOf(screen({ rate: 60 }), screen(), screen({ path: "ark" }));
    const b = summaryOf(
      screen({ rate: 60 }),
      screen({ p90: { ms: 80, over: false }, p99: { ms: 40, over: false }, gpuMs: 6 }),
      screen({ path: "ark" })
    );

    const { rows } = compare(a, b);

    expect(rows.map(row => `${row.path}@${row.rate}`)).toEqual([
      "ark@120",
      "garden/boss@120",
      "garden/boss@60"
    ]);
    expect(rows[1]?.worse).toEqual(["p99", "gpu"]);
  });
});

describe("compareText", () => {
  it("prints cells as A → B with the arrow and percent, dashes for a missing side", () => {
    const comparison = compare(
      summaryOf(screen({ p90: { ms: 18, over: false } })),
      summaryOf(screen({ p90: { ms: 13, over: false } }), screen({ path: "shop" }))
    );

    const text = compareText(comparison, { a: "a.jsonl", b: "b.jsonl" });

    expect(text[0]).toBe("Compare A a.jsonl → B b.jsonl");
    const boss = text.find(line => line.includes("garden/boss")) ?? "";
    expect(boss).toContain("18 → 13 ▼28%");
    expect(boss).toContain("25 → 25");
    const shop = text.find(line => line.includes("shop")) ?? "";
    expect(shop).toContain("— → 100");
    expect(text.some(line => line.startsWith("A:"))).toBe(false);
  });

  it("adds one line per log with its rate switches when either log switched", () => {
    const switched: LogSummary = {
      ...summaryOf(screen()),
      rateSwitches: [{ at: 482, from: 120, to: 60, reason: "missed", mode: "auto" }]
    };

    const text = compareText(compare(switched, summaryOf(screen())), { a: "a", b: "b" });

    expect(text.slice(-2)).toEqual(["A: 120 → 60 at 08:02 (missed)", "B: no switch"]);
  });
});
