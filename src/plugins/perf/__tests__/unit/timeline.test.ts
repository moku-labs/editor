/* eslint-disable unicorn/no-null -- null is "between frames" and "not measured" in the engine's lines */
import { describe, expect, it } from "vitest";
import { DISPLAY, markLine, rateChange } from "../../../../../tests/fixtures/fake-monitor";
import type { Json } from "../../../registry/protocol";
import type { PerfEventNameNext, PerfMarkLine, TimelineEventLine } from "../../protocol";
import { timelineEventOf } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/timeline timelineEventOf (spec 03 Delta 2026-10-16 D4): the mark the
// tools page draws for a kept stream line, on the page clock of the frames.
// ─────────────────────────────────────────────────────────────────────────────

/** header.timeOrigin of the test page: line `t` is epoch ms, the timeline's `t` page-clock ms. */
const ORIGIN = 1_760_453_960_000;

/**
 * An event line of the 0.15.x engine or later, written at page-clock 80310.2 ms.
 *
 * @param name - The event's name.
 * @param frame - Its frame; null between frames.
 * @param detail - Its detail.
 * @returns The line.
 */
function line(
  name: PerfEventNameNext,
  frame: number | null,
  detail: Readonly<Record<string, Json>>
): TimelineEventLine {
  return { v: 1, kind: "event", t: ORIGIN + 80_310.2, build: null, frame, name, detail };
}

/** A flagged problem without a reason: any rule but `filter-still`. */
const FLAGGED = {
  rule: "filter-still",
  severity: "warn",
  owner: 412,
  view: "fogLayer",
  filter: "fog.blur",
  value: 6.2,
  threshold: 2,
  since: 4802,
  frames: 53
};

/** A flagged `filter-still` of the 0.15.x engine (engine U5), with its reason. */
const STILL = { ...FLAGGED, reason: "budget" };

describe("timelineEventOf", () => {
  it("places a rate change on the page clock with its seq (bug: epoch ms drawn 1.7e12 ms right of the frames)", () => {
    expect(timelineEventOf(line("rate", 4855, rateChange()), 812, ORIGIN)).toEqual({
      seq: 812,
      kind: "rate",
      t: 80_310.2,
      frame: 4855,
      from: 120,
      to: 60,
      mode: "auto",
      reason: "missed",
      displayHz: 120
    });
  });

  it("keeps a shader compile with the pass it ran during, and a newer engine's `what` by name (bug: a variant or relink vanishing)", () => {
    const during = { pass: 2, filter: "fog.blur", owner: 412, view: "fogLayer" };
    const detail = {
      what: "relink",
      label: "fog.blur",
      ms: 38.25,
      frame: 4851,
      boot: false,
      during
    };
    expect(timelineEventOf(line("shader", 4851, detail), 790, ORIGIN)).toEqual({
      seq: 790,
      kind: "shader",
      t: 80_310.2,
      frame: 4851,
      what: "relink",
      label: "fog.blur",
      ms: 38.25,
      boot: false,
      ...during
    });
  });

  it("shows an old engine's compile { frame, count } as a compile without ms (bug: compiles vanish before the 0.15.x patch)", () => {
    expect(timelineEventOf(line("compile", 4851, { frame: 4851, count: 2 }), 3, ORIGIN)).toEqual({
      seq: 3,
      kind: "shader",
      t: 80_310.2,
      frame: 4851,
      what: "compile",
      label: null,
      ms: null,
      boot: false,
      pass: null,
      filter: null,
      owner: null,
      view: null
    });
  });

  it("keeps a flagged problem with its reason, an unknown rule by name, and a clear for its owner and view (bug: a newer engine's rule vanishes, or one view's clear clears the other)", () => {
    expect(timelineEventOf(line("problem", 4802, STILL), 1, ORIGIN)).toEqual({
      seq: 1,
      kind: "problem",
      t: 80_310.2,
      frame: 4802,
      ...STILL,
      cleared: false
    });

    const newer = { ...FLAGGED, rule: "pass-budget" };
    expect(timelineEventOf(line("problem", 4803, newer), 2, ORIGIN)).toMatchObject({
      rule: "pass-budget",
      reason: null,
      cleared: false
    });

    const cleared = { rule: "filter-still", cleared: true, owner: 412, view: "fogLayer" };
    expect(timelineEventOf(line("problem", 4870, cleared), 3, ORIGIN)).toEqual({
      seq: 3,
      kind: "problem",
      t: 80_310.2,
      frame: 4870,
      rule: "filter-still",
      severity: "info",
      cleared: true,
      owner: 412,
      view: "fogLayer",
      filter: null,
      value: null,
      threshold: null,
      since: null,
      frames: null,
      reason: null
    });
  });

  it("skips a malformed detail without throwing (bug: one bad line from a newer engine crashing the events feed)", () => {
    const throwing = Object.defineProperty({}, "what", {
      enumerable: true,
      get(): never {
        throw new Error("hostile");
      }
    });
    const malformed: [PerfEventNameNext, Readonly<Record<string, Json>>][] = [
      ["problem", { ...STILL, severity: "error" }],
      ["problem", { severity: "warn", owner: 412, view: null }],
      ["rate", { from: 120, to: 60 }],
      ["gc", { freedMb: "4.2", heapMb: 41.9, hint: true }],
      ["shader", { what: "compile", label: null, ms: 3, frame: 4851, boot: false }],
      ["shader", throwing],
      ["pool-trim", { reason: "boredom", freedMb: 1 }],
      ["recorder", { action: "rewind" }],
      ["sections", { on: "passes", off: [] }],
      ["display", { ...DISPLAY, hz: null }],
      ["problem", { ...STILL, owner: "412" }]
    ];
    for (const [name, detail] of malformed) {
      expect(timelineEventOf(line(name, 4851, detail), 0, ORIGIN), name).toBeUndefined();
    }
    expect(timelineEventOf(line("compile", null, { count: 2 }), 0, ORIGIN)).toBeUndefined();
    const unlabelled = { ...markLine("boss fight"), label: 5 } as unknown as PerfMarkLine;
    expect(timelineEventOf(unlabelled, 0, ORIGIN)).toBeUndefined();
  });

  it("keeps GCs, pool trims, recorder actions, marks and section switches with their fields (bug: a GC diamond or a recording mark missing)", () => {
    expect(
      timelineEventOf(line("gc", 4818, { freedMb: 4.2, heapMb: 41.9, hint: true }), 4, ORIGIN)
    ).toEqual({ seq: 4, kind: "gc", t: 80_310.2, frame: 4818, freedMb: 4.2, heapMb: 41.9 });
    expect(
      timelineEventOf(line("pool-trim", 4811, { reason: "rest", freedMb: 41.5 }), 5, ORIGIN)
    ).toMatchObject({ kind: "pool-trim", reason: "rest", freedMb: 41.5 });
    const start = { action: "start", label: "boss", by: "agent", name: "Claude" };
    expect(timelineEventOf(line("recorder", null, start), 6, ORIGIN)).toEqual({
      seq: 6,
      kind: "recorder",
      t: 80_310.2,
      frame: null,
      action: "start",
      by: "agent"
    });
    expect(timelineEventOf(line("recorder", null, { action: "stop" }), 7, ORIGIN)).toMatchObject({
      action: "stop",
      by: null
    });
    expect(timelineEventOf(markLine("boss fight"), 8, ORIGIN)).toEqual({
      seq: 8,
      kind: "mark",
      t: 42_000,
      frame: null,
      label: "boss fight",
      auto: false
    });
    const sections = { on: ["passes", "warp"], off: ["nodes"] };
    expect(timelineEventOf(line("sections", null, sections), 9, ORIGIN)).toMatchObject({
      kind: "sections",
      on: ["passes"],
      off: ["nodes"]
    });
  });

  it("keeps a display's new rate and nothing for the editor's own lines (bug: the devtools window or a door command drawn as a timeline mark)", () => {
    expect(timelineEventOf(line("display", null, { ...DISPLAY, hz: 60 }), 10, ORIGIN)).toEqual({
      seq: 10,
      kind: "display",
      t: 80_310.2,
      frame: null,
      hz: 60
    });
    for (const name of ["devtools", "command", "overlay", "scene", "warm"] as const) {
      expect(timelineEventOf(line(name, 4851, { mode: "card" }), 0, ORIGIN), name).toBeUndefined();
    }
  });
});
