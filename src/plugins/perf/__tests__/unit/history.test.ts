/* eslint-disable unicorn/no-null -- null is "not measured" and "between frames" on the wire */
import { describe, expect, it } from "vitest";
import { sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import {
  heapMeasured,
  logLeak,
  measureGrowth
} from "../../../../../tests/integration/helpers/heap";
import type {
  PassChainSummary,
  PerfEventsWire,
  PerfHistory,
  PerfPassesWire,
  PerfTimelineEvent
} from "../../protocol";
import {
  appendEvents,
  appendFrames,
  appendSample,
  appendSecond,
  CAUSE_BITS,
  clearPerfHistory,
  createPerfHistory,
  PASS_KINDS,
  rangeRows,
  rangeSummary
} from "../../protocol";
import type { WirePass, WireRow } from "../wire-fixtures";
import { EPOCH, framesWire, runOf } from "../wire-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/history (spec 03 Delta 2026-10-16 D10): the tools page's 2-minute
// history of one source, filled from the feeds, read by range.
// ─────────────────────────────────────────────────────────────────────────────

/** Bytes in a KiB. */
const KIB = 1024;

/** A test's own bound for the heap probe and the long-session runs. */
const TEST_MS = 60_000;

/** The cause bits of a frame whose JS work ran with a shader compile: primary cause "compile". */
const COMPILE_SPIKE = (1 << CAUSE_BITS.indexOf("js")) | (1 << CAUSE_BITS.indexOf("compile"));

/**
 * The frame numbers the history holds, oldest first.
 *
 * @param history - The history.
 * @returns The frames.
 */
function framesOf(history: PerfHistory): number[] {
  return [...history.frame.subarray(0, history.count)];
}

/**
 * The page-clock time of a frame of the range scenario: 10 ms a frame from frame 4800 at 80 s.
 *
 * @param frame - The frame.
 * @returns Its start, ms.
 */
function timeOf(frame: number): number {
  return 80_000 + (frame - 4800) * 10;
}

/** header.timeOrigin of the test page: the raw lines carry epoch ms. */
const ORIGIN = 1_792_000_000_000;

/**
 * The raw line the agent would send for a timeline event (the kinds these tests use: gc, rate,
 * shader), so `appendEvents` builds the event back with `eventsOf`.
 *
 * @param event - The event.
 * @returns The wire item.
 */
function itemOf(event: PerfTimelineEvent): PerfEventsWire["items"][number] {
  const head = {
    v: 1,
    kind: "event",
    t: ORIGIN + event.t,
    build: null,
    frame: event.frame
  } as const;
  if (event.kind === "gc") {
    const detail = { freedMb: event.freedMb, heapMb: event.heapMb, hint: true };
    return { seq: event.seq, line: { ...head, name: "gc", detail } };
  }
  if (event.kind === "rate") {
    const { from, to, mode, reason, displayHz } = event;
    const window = { drawn: 41, missed: 9, heavy: 0 };
    const detail = { from, to, mode, reason, displayHz, thermal: "none", window, dwellMs: 5000 };
    return { seq: event.seq, line: { ...head, name: "rate", detail } };
  }
  if (event.kind !== "shader") throw new Error(`no raw line for a ${event.kind} event`);
  const { what, label, ms, frame, boot, pass, filter, owner, view } = event;
  const detail = { what, label, ms, frame, boot, during: { pass, filter, owner, view } };
  return { seq: event.seq, line: { ...head, name: "shader", detail } };
}

/**
 * An events wire of the test page: the events as the raw lines the agent sends.
 *
 * @param items - The events, oldest first.
 * @param next - The seq of the next event.
 * @param options - Epoch and loss.
 * @param options.epoch - The page's epoch (the test page's by default).
 * @param options.lost - Events were overwritten before this read.
 * @returns The wire.
 */
function eventsWire(
  items: PerfTimelineEvent[],
  next: number,
  options: { epoch?: string; lost?: boolean } = {}
): PerfEventsWire {
  return {
    v: 1,
    epoch: options.epoch ?? EPOCH,
    timeOrigin: ORIGIN,
    next,
    lost: options.lost ?? false,
    items: items.map(event => itemOf(event))
  };
}

/**
 * A GC mark of the timeline.
 *
 * @param seq - Its seq.
 * @param frame - Its frame.
 * @returns The event.
 */
function gcEvent(seq: number, frame: number): PerfTimelineEvent {
  return { seq, kind: "gc", t: timeOf(frame), frame, freedMb: 4.2, heapMb: 41.9 };
}

/**
 * An `editor.perf.passes` answer of a second whose engine sent its `passes` line with these chains
 * (the tools page keeps the line's chains as they came).
 *
 * @param t - Page-clock ms of the end of the second.
 * @param chains - Its chains.
 * @returns The answer.
 */
function passesWire(t: number, chains: PassChainSummary[] = []): PerfPassesWire {
  return {
    v: 1,
    source: "engine",
    t,
    frames: 60,
    tiler: false,
    gpuTimer: true,
    rows: null,
    heaviest: null,
    line: {
      t: ORIGIN + t,
      chains: chains.map(({ share: _share, ...chain }) => chain),
      heaviest: null
    },
    shaders: null,
    targets: null,
    lost: 0
  };
}

describe("appendFrames", () => {
  it("skips the frames it holds when two reads overlap (bug: overlapping reads double a frame)", () => {
    const history = createPerfHistory();
    expect(appendFrames(history, framesWire(runOf(100, 5)))).toEqual({
      added: 5,
      hole: false,
      reset: false
    });
    const { version } = history;

    expect(appendFrames(history, framesWire(runOf(103, 4, 80_030)))).toEqual({
      added: 2,
      hole: false,
      reset: false
    });
    expect(framesOf(history)).toEqual([100, 101, 102, 103, 104, 105, 106]);
    expect(history.t[6]).toBe(80_060);
    expect(history.version).toBe(version + 1);

    expect(appendFrames(history, framesWire(runOf(101, 3, 80_010))).added).toBe(0);
    expect(history.version).toBe(version + 1);
  });

  it("records a hole for a frame jump and for a wire that says frames were lost (bug: a stall drawn as continuous frames)", () => {
    const history = createPerfHistory();
    expect(appendFrames(history, framesWire(runOf(100, 3), { hole: true })).hole).toBe(false);
    expect(appendFrames(history, framesWire(runOf(110, 2, 80_200))).hole).toBe(true);
    expect(appendFrames(history, framesWire(runOf(112, 2, 80_220), { hole: true })).hole).toBe(
      true
    );
    const jumpInside: WireRow[] = [
      { frame: 114, t: 80_240 },
      { frame: 115, t: 80_250 },
      { frame: 118, t: 80_280 }
    ];
    appendFrames(history, framesWire(jumpInside));
    expect([...history.holes.subarray(0, history.holeCount)]).toEqual([102, 111, 115]);
  });

  it("clears the frames, events and seconds of the old page on a new epoch (bug: a reloaded game's frame 4 appended after frame 9000)", () => {
    const history = createPerfHistory();
    appendFrames(history, framesWire(runOf(9000, 3)));
    appendEvents(history, eventsWire([gcEvent(5, 9001)], 6));
    appendSecond(history, passesWire(81_000));

    const reload = "1792000099999.5";
    expect(appendFrames(history, framesWire(runOf(4, 2), { epoch: reload }))).toEqual({
      added: 2,
      hole: false,
      reset: true
    });
    expect(framesOf(history)).toEqual([4, 5]);
    expect(history.epoch).toBe(reload);
    expect(history.eventCount).toBe(0);
    expect(history.eventsNext).toBeUndefined();
    expect(history.secondCount).toBe(0);
  });

  it("drops the oldest rows past 14 400 and keeps systems, nodes, draws and pass rows with their frames (bug: systems of the wrong frame after the drop)", {
    timeout: TEST_MS
  }, () => {
    const history = createPerfHistory();
    for (let wire = 0; wire < 15; wire += 1) {
      const rows = runOf(wire * 1000, 1000, wire * 1000, 1).map(row => ({
        ...row,
        nodes: row.frame % 50,
        draws: row.frame % 30,
        systems: [[`sys${row.frame % 3}`, row.frame % 100] as const]
      }));
      const passes: WirePass[] = rows.map((row, index) => ({
        row: index,
        index: 0,
        view: `v${row.frame % 2}`,
        gpuMs: row.frame % 10
      }));
      appendFrames(history, framesWire(rows, { systems: true, nodes: true, draws: true, passes }));
    }

    expect(history.count).toBe(14_400);
    expect(history.frame[0]).toBe(600);
    expect(history.frame[14_399]).toBe(14_999);
    expect(history.passCount).toBe(14_400);
    expect(history.passFrame[0]).toBe(600);
    let wrong = 0;
    for (let row = 0; row < history.count; row += 1) {
      const frame = history.frame[row] ?? -1;
      const name = history.systemNames[history.sysIdx[row * 5] ?? -1];
      if (name !== `sys${frame % 3}` || history.sysMs[row * 5] !== frame % 100) wrong += 1;
      if (history.sysIdx[row * 5 + 1] !== -1) wrong += 1;
      if (history.nodes[row] !== frame % 50 || history.draws[row] !== frame % 30) wrong += 1;
      const passFrame = history.passFrame[row] ?? -1;
      const view = history.passNames[history.passView[row] ?? 0];
      if (view !== `v${passFrame % 2}` || history.passGpuMs[row] !== passFrame % 10) wrong += 1;
    }
    expect(wrong).toBe(0);
  });

  it("keeps the newest 14 400 rows of one wire larger than the history (bug: rows written past the end of the columns)", () => {
    const history = createPerfHistory();
    const result = appendFrames(history, framesWire(runOf(0, 15_000, 0, 1)));
    expect(result.added).toBe(14_400);
    expect(history.count).toBe(14_400);
    expect([history.frame[0], history.frame[14_399], history.t[0]]).toEqual([600, 14_999, 600]);
  });

  it("keeps two minutes and allocates nothing while it trims (bug: the tools page growing for hours)", {
    timeout: TEST_MS
  }, async () => {
    const history = createPerfHistory();
    const systems = [["ward.update", 6.2] as const, ["fog.render", 1.4] as const];
    const second = (round: number): void => {
      const rows = runOf(round * 100, 100, round * 1000, 10, { systems, nodes: 3, draws: 40 });
      const passes: WirePass[] = rows.flatMap((_row, index) => [
        { row: index, index: 0, kind: "canvas", view: "main", gpuMs: 2 },
        { row: index, index: 1, kind: "filter", view: "fogLayer", owner: 412, filter: "fog.blur" }
      ]);
      appendFrames(history, framesWire(rows, { systems: true, nodes: true, draws: true, passes }));
    };

    const ceiling = { heapBytes: 256 * KIB, objects: 1000 };
    const growth = await measureGrowth(second, { warmup: 150, rounds: 100, ceiling });
    logLeak("perf history, 100 s of appendFrames past its 2 minutes", growth);

    const newest = history.t[history.count - 1] ?? 0;
    expect(newest).toBe(249_990);
    expect(history.t[0]).toBe(129_990);
    expect(history.count).toBe(12_001);
    expect(history.passFrame[0]).toBe(history.frame[0]);
    if (growth.objects !== undefined) expect(growth.objects).toBeLessThan(ceiling.objects);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(ceiling.heapBytes);
  });

  it("keeps a system's name when the next wire's names table lists it at another index (bug: a system's ms attributed to another system)", () => {
    const history = createPerfHistory();
    const first = runOf(100, 1, 80_000, 10, {
      systems: [
        ["ward.update", 6],
        ["fog.render", 1]
      ]
    });
    const next = runOf(101, 1, 80_010, 10, {
      systems: [
        ["fog.render", 2],
        ["boss.ai", 3]
      ]
    });
    appendFrames(history, framesWire(first, { systems: true }));
    appendFrames(history, framesWire(next, { systems: true }));

    expect(history.systemNames).toEqual(["ward.update", "fog.render", "boss.ai"]);
    const named = [0, 1].map(slot => [
      history.systemNames[history.sysIdx[5 + slot] ?? -1],
      history.sysMs[5 + slot]
    ]);
    expect(named).toEqual([
      ["fog.render", 2],
      ["boss.ai", 3]
    ]);
  });

  it("reads back every pass row's kind, view, owner, filter, format and measures, null staying null (bug: interned ids mixing names)", () => {
    const history = createPerfHistory();
    const passes: WirePass[] = [
      {
        row: 0,
        index: 0,
        kind: "canvas",
        view: "main",
        format: "bgra8unorm",
        gpuMs: 3.5,
        draws: 41
      },
      {
        row: 0,
        index: 1,
        kind: "filter",
        view: "fogLayer",
        owner: 412,
        filter: "fog.blur",
        format: "rgba16float",
        resolution: 0.5,
        w: 540,
        h: 1170
      },
      { row: 0, index: 2, kind: "texture" }
    ];
    appendFrames(history, framesWire(runOf(100, 1), { passes }));

    const rows = [0, 1, 2].map(pass => ({
      kind: PASS_KINDS[history.passKind[pass] ?? -1],
      view: history.passNames[history.passView[pass] ?? 0],
      owner: history.passOwner[pass],
      filter: history.passNames[history.passFilter[pass] ?? 0],
      format: history.passNames[history.passFormat[pass] ?? 0],
      size: [history.passW[pass], history.passH[pass]],
      resolution: history.passResolution[pass],
      draws: history.passDraws[pass],
      gpuMs: history.passGpuMs[pass]
    }));
    expect(rows).toEqual([
      {
        kind: "canvas",
        view: "main",
        owner: 0,
        filter: null,
        format: "bgra8unorm",
        size: [1080, 2340],
        resolution: Number.NaN,
        draws: 41,
        gpuMs: 3.5
      },
      {
        kind: "filter",
        view: "fogLayer",
        owner: 412,
        filter: "fog.blur",
        format: "rgba16float",
        size: [540, 1170],
        resolution: 0.5,
        draws: Number.NaN,
        gpuMs: Number.NaN
      },
      {
        kind: "texture",
        view: null,
        owner: 0,
        filter: null,
        format: null,
        size: [1080, 2340],
        resolution: Number.NaN,
        draws: Number.NaN,
        gpuMs: Number.NaN
      }
    ]);
  });

  it("names every held pass row right after more than 65 535 distinct names in one session (bug: the name table running out of ids)", {
    timeout: TEST_MS
  }, () => {
    const history = createPerfHistory();
    for (let wire = 0; wire < 20; wire += 1) {
      const rows = runOf(wire * 1000, 1000, wire * 1000, 1);
      const passes: WirePass[] = rows.flatMap((row, index) =>
        [0, 1, 2, 3].map(pass => ({ row: index, index: pass, view: `v${row.frame}-${pass}` }))
      );
      appendFrames(history, framesWire(rows, { passes }));
    }

    expect(history.passCount).toBe(57_600);
    expect(history.passNames.length).toBeLessThanOrEqual(65_536);
    let wrong = 0;
    for (let pass = 0; pass < history.passCount; pass += 1) {
      const view = history.passNames[history.passView[pass] ?? 0];
      if (view !== `v${history.passFrame[pass]}-${history.passIndex[pass]}`) wrong += 1;
    }
    expect(wrong).toBe(0);
  });
});

describe("appendEvents, appendSecond and appendSample", () => {
  it("adds events after the newest seq only, keeps `next`, records a loss as a hole and holds the newest 1024 (bug: a GC drawn twice, a missed GC never noticed)", () => {
    const history = createPerfHistory();
    appendFrames(history, framesWire(runOf(4800, 10)));
    expect(appendEvents(history, eventsWire([gcEvent(1, 4801), gcEvent(2, 4802)], 3))).toBe(2);
    expect(appendEvents(history, eventsWire([gcEvent(2, 4802), gcEvent(3, 4803)], 4))).toBe(1);
    expect(history.eventsNext).toBe(4);
    expect(appendEvents(history, eventsWire([gcEvent(300, 4809)], 301, { lost: true }))).toBe(1);
    expect([...history.eventHoles.subarray(0, history.eventHoleCount)]).toEqual([3]);
    const seqs = history.events.slice(0, history.eventCount).map(event => event?.seq);
    expect(seqs).toEqual([1, 2, 3, 300]);

    const burst = Array.from({ length: 1100 }, (_, index) => gcEvent(400 + index, 4809));
    expect(appendEvents(history, eventsWire(burst, 1500))).toBe(1024);
    expect(history.eventCount).toBe(1024);
    expect(history.events[0]?.seq).toBe(476);
    expect(history.events[1023]?.seq).toBe(1499);
  });

  it("clears the old page when the events come from a new epoch first (bug: a reloaded page's first events dropped as already seen)", () => {
    const history = createPerfHistory();
    appendFrames(history, framesWire(runOf(9000, 3)));
    appendEvents(history, eventsWire([gcEvent(40, 9001)], 41));
    expect(appendEvents(history, eventsWire([gcEvent(0, 2)], 1, { epoch: "other" }))).toBe(1);
    expect(history.count).toBe(0);
    expect(history.epoch).toBe("other");
    expect(history.events[0]?.seq).toBe(0);
  });

  it("adds a passes summary and a sample once each and keeps the newest 120 (bug: a watched value read twice doubling the per-second history)", () => {
    const history = createPerfHistory();
    expect(appendSecond(history, passesWire(81_000))).toBe(true);
    expect(appendSecond(history, passesWire(81_000))).toBe(false);
    for (let second = 1; second <= 130; second += 1) {
      appendSecond(history, passesWire(81_000 + second * 1000));
    }
    expect(history.secondCount).toBe(120);
    expect(history.seconds[0]?.t).toBe(92_000);

    expect(appendSample(history, sampleLine(4830))).toBe(true);
    expect(appendSample(history, sampleLine(4830))).toBe(false);
    for (let second = 1; second <= 130; second += 1) {
      appendSample(history, sampleLine(4830 + second * 60));
    }
    expect(history.sampleCount).toBe(120);
    expect(history.samples[0]?.frame).toBe(4830 + 11 * 60);
  });
});

describe("rangeRows and rangeSummary", () => {
  it("finds the rows of a range, clamped to the held frames, either way round, and -1 when none is held, the range then being a hole (bug: a selection past the newest frame selecting nothing)", () => {
    const history = createPerfHistory();
    appendFrames(history, framesWire(runOf(100, 5)));
    appendFrames(history, framesWire(runOf(110, 5, 80_100)));
    expect(rangeRows(history, 101, 103)).toEqual({ first: 1, last: 3 });
    expect(rangeRows(history, 103, 101)).toEqual({ first: 1, last: 3 });
    expect(rangeRows(history, 104, 500)).toEqual({ first: 4, last: 9 });
    expect(rangeRows(history, 105, 109)).toEqual({ first: -1, last: -1 });
    expect(rangeRows(history, 0, 50)).toEqual({ first: -1, last: -1 });

    expect(rangeSummary(history, 105, 109)).toMatchObject({
      frames: 0,
      durationMs: 0,
      worstMs: null,
      systems: [],
      spikes: [],
      nodes: null,
      holes: [104]
    });
  });

  it("sums frames 4810-4860: top-5 systems with their share and max frame, spikes, GCs, rate changes, compiles, passes, chains, nodes and holes (bug: a range inspector that reads the wrong totals)", () => {
    const history = createPerfHistory();
    const rows: WireRow[] = [];
    const passes: WirePass[] = [];
    for (let frame = 4800; frame <= 4870; frame += 1) {
      if (frame === 4841 || frame === 4842) continue;
      const spike = frame === 4851;
      const row = rows.length;
      rows.push({
        frame,
        t: timeOf(frame),
        ms: spike ? 41.3 : 9,
        causes: spike ? COMPILE_SPIKE : 0,
        nodes: 2,
        systems: [
          ["ward.update", spike ? 9.1 : 6.2],
          ["fog.render", 1.4]
        ]
      });
      passes.push(
        { row, index: 0, kind: "canvas", view: "main", gpuMs: 3 },
        {
          row,
          index: 1,
          kind: "filter",
          view: "fogLayer",
          owner: 412,
          filter: "fog.blur",
          gpuMs: 1.5
        },
        {
          row,
          index: 2,
          kind: "filter",
          view: "fogLayer",
          owner: 412,
          filter: "colorMatrix",
          gpuMs: 0.5
        }
      );
    }
    appendFrames(history, framesWire(rows, { systems: true, nodes: true, passes }));

    const rate = (seq: number, frame: number | null, t: number, from: number, to: number) =>
      ({
        seq,
        kind: "rate",
        t,
        frame,
        from,
        to,
        mode: "auto",
        reason: to < from ? "missed" : "headroom",
        displayHz: 120
      }) satisfies PerfTimelineEvent;
    const compile: PerfTimelineEvent = {
      seq: 5,
      kind: "shader",
      t: timeOf(4851),
      frame: 4851,
      what: "compile",
      label: "fog.blur",
      ms: 38.2,
      boot: false,
      pass: 1,
      filter: "fog.blur",
      owner: 412,
      view: "fogLayer"
    };
    const events = [
      gcEvent(1, 4805),
      gcEvent(2, 4818),
      rate(3, null, timeOf(4830) + 5, 60, 120),
      rate(4, 4855, timeOf(4855), 120, 60),
      compile,
      rate(6, 4865, timeOf(4865), 60, 120)
    ];
    appendEvents(history, eventsWire(events, 7));

    expect(rangeSummary(history, 4810, 4860)).toEqual({
      from: 4810,
      to: 4860,
      frames: 49,
      durationMs: 509,
      seconds: 0,
      worstMs: 41.3,
      jsMs: 392,
      systems: [
        { name: "ward.update", totalMs: 306.7, share: 0.782, maxMs: 9.1 },
        { name: "fog.render", totalMs: 68.6, share: 0.175, maxMs: 1.4 }
      ],
      systemsPerSecond: false,
      spikes: [{ frame: 4851, cause: "compile", ms: 41.3 }],
      gcs: [{ frame: 4818, t: timeOf(4818), freedMb: 4.2 }],
      rates: [
        { frame: null, from: 60, to: 120, reason: "headroom" },
        { frame: 4855, from: 120, to: 60, reason: "missed" }
      ],
      compiles: [{ frame: 4851, what: "compile", label: "fog.blur", ms: 38.2, boot: false }],
      passes: [
        { kind: "canvas", view: "main", count: 49, gpuMs: 147, share: 0.6 },
        { kind: "filter", view: "fogLayer", count: 98, gpuMs: 98, share: 0.4 }
      ],
      chains: [
        { owner: 412, view: "fogLayer", kinds: ["fog.blur", "colorMatrix"], applies: 98, gpuMs: 98 }
      ],
      passesPerSecond: false,
      nodes: 98,
      holes: [4840]
    });
  });

  it("prorates the seconds' systems and chains when the rows carry none (bug: a range inspector that reads 0 systems on a 0.15.0 engine)", () => {
    const history = createPerfHistory();
    appendFrames(history, framesWire(runOf(4800, 71)));
    appendSample(
      history,
      sampleLine(4830, { frames: 60, systems: [{ name: "ward.update", mean: 6, max: 9 }] })
    );
    appendSample(
      history,
      sampleLine(4890, {
        frames: 60,
        systems: [
          { name: "ward.update", mean: 5, max: 7 },
          { name: "boss.ai", mean: 1, max: 2 }
        ]
      })
    );
    const chain: PassChainSummary = {
      owner: 412,
      view: "fogLayer",
      kinds: ["fog.blur"],
      applies: 120,
      mpx: 1,
      draws: null,
      gpuMs: { p50: 2, max: 3 },
      share: 0.5
    };
    appendSecond(history, passesWire(80_300, [chain]));
    appendSecond(history, passesWire(81_300, [chain]));

    const summary = rangeSummary(history, 4810, 4860);
    expect(summary.systemsPerSecond).toBe(true);
    expect(summary.systems).toEqual([
      { name: "ward.update", totalMs: 276, share: 0.676, maxMs: 9 },
      { name: "boss.ai", totalMs: 30, share: 0.074, maxMs: 2 }
    ]);
    expect(summary.seconds).toBe(2);
    expect(summary.passesPerSecond).toBe(true);
    expect(summary.passes).toEqual([]);
    expect(summary.chains).toEqual([
      { owner: 412, view: "fogLayer", kinds: ["fog.blur"], applies: 61, gpuMs: 122.16 }
    ]);
  });
});

describe("clearPerfHistory", () => {
  it("empties the history in place for another source: same arrays, no names, a new version (bug: the old device's frames under the new one, or 3 MB reallocated per switch)", () => {
    const history = createPerfHistory();
    const passes: WirePass[] = [{ row: 0, index: 0, view: "main" }];
    const rows = runOf(100, 2, 80_000, 10, { systems: [["ward.update", 6]] });
    appendFrames(history, framesWire(rows, { systems: true, passes }));
    appendEvents(history, eventsWire([gcEvent(1, 100)], 2));
    appendSecond(history, passesWire(81_000));
    appendSample(history, sampleLine(100));
    const { frame, passView, version } = history;

    clearPerfHistory(history);
    expect(history).toMatchObject({
      count: 0,
      passCount: 0,
      eventCount: 0,
      secondCount: 0,
      sampleCount: 0,
      holeCount: 0,
      eventHoleCount: 0,
      epoch: null,
      eventsNext: undefined,
      systemNames: [],
      passNames: [null]
    });
    expect(history.frame).toBe(frame);
    expect(history.passView).toBe(passView);
    expect(history.version).toBeGreaterThan(version);
    expect(history.events[0]).toBeUndefined();
    expect(appendFrames(history, framesWire(runOf(100, 1))).added).toBe(1);
  });
});
