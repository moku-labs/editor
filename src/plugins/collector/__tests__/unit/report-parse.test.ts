/* eslint-disable unicorn/no-null -- null is "not measured" in the log lines and summaries */
import { describe, expect, it } from "vitest";
import { isPerfLog, parsePerfLog } from "../../report";
import {
  eventLine,
  headerLine,
  histOf,
  jsonl,
  markLine,
  rateLine,
  sampleLine,
  spikeLine,
  thermalLine
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// parsePerfLog and isPerfLog: one pass over the lines; every line it does not
// keep is counted by reason, never misread.
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePerfLog", () => {
  it("counts a cut-off last line as notJson and keeps the lines before it (bug: a log cut mid-write unreadable)", () => {
    const text = `${jsonl([headerLine(), sampleLine(1000)])}{"v":1,"kind":"sam`;

    const log = parsePerfLog(text);

    expect(log.samples).toHaveLength(1);
    expect(log.header?.kind).toBe("header");
    expect(log.skipped.notJson).toBe(1);
    expect(log.lines).toBe(3);
  });

  it("skips and counts the game's old log (no v), and isPerfLog refuses it", () => {
    const text = jsonl([
      { t: 1_791_830_588_000, kind: "mark", label: "ward" },
      { t: 1_791_830_589_000, path: "ward", fps: { avg: 59.8, low: 58 } }
    ]);

    const log = parsePerfLog(text);

    expect(log.skipped.noVersion).toBe(2);
    expect(log.marks).toEqual([]);
    expect(isPerfLog(log)).toBe(false);
  });

  it("skips and counts a v2 line instead of misreading it (bug: a newer log read as v1)", () => {
    const text = jsonl([headerLine(), { ...sampleLine(1000), v: 2 }, sampleLine(2000)]);

    const log = parsePerfLog(text);

    expect(log.skipped.otherVersion).toBe(1);
    expect(log.samples.map(sample => sample.t)).toEqual([2000]);
  });

  it("counts an unknown kind and keeps an unknown field untouched, without throwing", () => {
    const text = jsonl([
      { v: 1, kind: "future", t: 5 },
      { ...sampleLine(1000), extra: { a: 1 } }
    ]);

    const log = parsePerfLog(text);

    expect(log.skipped.unknownKind).toBe(1);
    expect(log.samples[0]).toMatchObject({ extra: { a: 1 } });
  });

  it("counts a sample whose frameHist has 80 slots as badShape (bug: percentiles off by a bucket)", () => {
    const short = { ...sampleLine(1000), frameHist: histOf({ 8: 10 }).slice(0, 80) };

    const log = parsePerfLog(jsonl([short, sampleLine(2000)]));

    expect(log.skipped.badShape).toBe(1);
    expect(log.samples).toHaveLength(1);
  });

  it("puts overlay, pool-trim and warm lines into frameEvents, rate lines into rates, and keeps no devtools line", () => {
    const text = jsonl([
      eventLine(10, "overlay", { entity: 412, label: "shopDimLayer", what: "open", mode: "modal" }),
      eventLine(11, "pool-trim", { reason: "scene", freedMb: 41.5 }),
      eventLine(12, "warm", { draws: 12 }),
      eventLine(13, "devtools", { mode: "card", tab: "frames" }),
      rateLine(14, 120, 60)
    ]);

    const log = parsePerfLog(text);

    expect(log.frameEvents.map(event => event.name)).toEqual(["overlay", "pool-trim", "warm"]);
    expect(log.rates.map(event => event.detail.to)).toEqual([60]);
    expect(log.lines).toBe(5);
    expect(log.skipped).toEqual({
      notJson: 0,
      noVersion: 0,
      otherVersion: 0,
      unknownKind: 0,
      badShape: 0
    });
  });

  it("counts an overlay line with what 'exiting' or without a label as badShape", () => {
    const text = jsonl([
      eventLine(10, "overlay", { entity: 1, label: "menu", what: "exiting", mode: "modal" }),
      eventLine(11, "overlay", { entity: 1, what: "open", mode: "modal" })
    ]);

    const log = parsePerfLog(text);

    expect(log.skipped.badShape).toBe(2);
    expect(log.frameEvents).toEqual([]);
  });

  it("counts a rate event without numeric from/to, a spike without rateMs and a thermal with a numeric device as badShape", () => {
    const spike = spikeLine(5, ["js"]);
    const text = jsonl([
      eventLine(1, "rate", { from: 120 }),
      { ...spike, frame: { ...spike.frame, rateMs: "fast" } },
      { ...thermalLine(7), device: 42 }
    ]);

    expect(parsePerfLog(text).skipped.badShape).toBe(3);
  });

  it("sums the gap lines into lost and keeps marks, thermal lines and the first header", () => {
    const text = jsonl([
      headerLine(0),
      headerLine(1, { build: "second" }),
      { v: 1, kind: "gap", t: 5, build: null, rx: 9, device: "SM-A266B", lines: 12 },
      { v: 1, kind: "gap", t: 6, build: null, rx: 9, device: "SM-A266B", lines: 3 },
      markLine(7, "boss"),
      thermalLine(8)
    ]);

    const log = parsePerfLog(text);

    expect(log.lost).toBe(15);
    expect(log.header?.t).toBe(0);
    expect(log.marks.map(mark => mark.label)).toEqual(["boss"]);
    expect(log.thermal).toHaveLength(1);
  });

  it("reads startup and longFrame lines without keeping or skipping them", () => {
    const log = parsePerfLog(
      jsonl([
        { v: 1, kind: "startup", t: 1, build: null, firstFrameMs: 400 },
        { v: 1, kind: "longFrame", t: 2, build: null, durationMs: 80 }
      ])
    );

    expect(log.lines).toBe(2);
    expect(Object.values(log.skipped).reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(isPerfLog(log)).toBe(false);
  });

  it("ignores empty lines", () => {
    const log = parsePerfLog(`\n${JSON.stringify(sampleLine(1000))}\n\n   \n`);

    expect(log.lines).toBe(1);
    expect(log.samples).toHaveLength(1);
  });
});

describe("isPerfLog", () => {
  it("accepts a log with a header or a sample", () => {
    expect(isPerfLog(parsePerfLog(jsonl([headerLine()])))).toBe(true);
    expect(isPerfLog(parsePerfLog(jsonl([sampleLine(1)])))).toBe(true);
    expect(isPerfLog(parsePerfLog(jsonl([markLine(1, "boss")])))).toBe(false);
  });
});
