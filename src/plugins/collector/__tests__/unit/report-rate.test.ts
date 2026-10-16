/* eslint-disable unicorn/no-null -- null is "not reported" on a FrameRate */
import { describe, expect, it } from "vitest";
import { compare, parsePerfLog, summarize, summaryText } from "../../report";
import {
  headerLine,
  headerWithoutRate,
  histOf,
  jsonl,
  rateLine,
  sampleLine,
  spikeLine
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Per-rate rows: the same screen at 120 and at 60 fps is two rows, the rate of
// a sample is the one in effect at its t, a spike's rate is its own frame's.
// ─────────────────────────────────────────────────────────────────────────────

/** A log that falls back from 120 to 60 between its second and third sample. */
const FALLBACK = [
  headerLine(),
  sampleLine(1000, { frameHist: histOf({ 8: 120 }) }),
  sampleLine(2000, { frameHist: histOf({ 8: 120 }) }),
  rateLine(2500, 120, 60, "missed"),
  sampleLine(3000, { frameHist: histOf({ 16: 60 }) }),
  sampleLine(4000, { frameHist: histOf({ 16: 60 }) }),
  rateLine(6000, 60, 120, "headroom")
];

/**
 * The rate of the one row of a log with a header and one sample.
 *
 * @param header - The header line.
 * @returns The row's rate.
 */
function rateOf(header: object): number | null | undefined {
  return summarize(parsePerfLog(jsonl([header, sampleLine(1000)]))).screens[0]?.rate;
}

describe("summarize — rates", () => {
  it("puts samples before and after a rate line into two rows of the same screen with their own p90 (bug: one p90 mixing 8.3 and 16.7 ms)", () => {
    const summary = summarize(parsePerfLog(jsonl(FALLBACK)));

    expect(
      summary.screens.map(screen => [screen.path, screen.rate, screen.p90?.ms, screen.seconds])
    ).toEqual([
      ["garden/boss", 120, 9, 2],
      ["garden/boss", 60, 17, 2]
    ]);
  });

  it("counts a spike at the rate of its own frame's rateMs", () => {
    const summary = summarize(
      parsePerfLog(
        jsonl([headerLine(), sampleLine(1000), spikeLine(1500, ["js"], { rateMs: 16.67 })])
      )
    );

    expect(summary.screens.map(screen => [screen.rate, screen.spikes])).toEqual([
      [120, 0],
      [60, 1]
    ]);
  });

  it("starts at header.rate.fps, else header.config.maxFps, else null", () => {
    const rate = {
      fps: 90,
      mode: "auto",
      reason: "start",
      displayHz: 90,
      ladder: [90],
      thermal: null,
      asked: null,
      heldBy: null
    } as const;

    expect(rateOf(headerLine(0, { rate }))).toBe(90);
    expect(rateOf(headerWithoutRate(60))).toBe(60);
    expect(rateOf(headerWithoutRate(0))).toBeNull();
  });

  it("lists every rate switch with its reason and mode, seconds from the first sample", () => {
    const summary = summarize(parsePerfLog(jsonl(FALLBACK)));

    expect(summary.rateSwitches).toEqual([
      { at: 1.5, from: 120, to: 60, reason: "missed", mode: "auto" },
      { at: 5, from: 60, to: 120, reason: "headroom", mode: "auto" }
    ]);
  });
});

describe("compare and text — rates", () => {
  it("compares a log at 120 with one at 60 in rows by path and rate, with no arrow (bug: a false ▲ across rates)", () => {
    const at120 = summarize(parsePerfLog(jsonl([headerLine(), sampleLine(1000)])));
    const at60 = summarize(
      parsePerfLog(
        jsonl([
          headerWithoutRate(60),
          sampleLine(1000, { frameHist: histOf({ 16: 60 }), gpuMs: null })
        ])
      )
    );

    const { rows } = compare(at120, at60);

    expect(rows.map(row => [row.path, row.rate, row.p90.a, row.p90.b, row.p90.arrow])).toEqual([
      ["garden/boss", 120, 9, null, null],
      ["garden/boss", 60, null, 17, null]
    ]);
    expect(rows.flatMap(row => row.worse)).toEqual([]);
  });

  it("prints the Rate: line only for a log with a switch", () => {
    const switched = summaryText(summarize(parsePerfLog(jsonl(FALLBACK))));
    const steady = summaryText(summarize(parsePerfLog(jsonl([headerLine(), sampleLine(1000)]))));

    expect(switched).toContain(
      "Rate: 00:01 120 → 60 (missed, auto) · 00:05 60 → 120 (headroom, auto)"
    );
    expect(steady.some(line => line.startsWith("Rate:"))).toBe(false);
  });
});
