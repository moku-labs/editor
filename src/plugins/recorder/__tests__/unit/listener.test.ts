/* eslint-disable unicorn/no-null -- null is "no input", "no header" and "between frames" of the engine */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY,
  debugLine,
  eventLine,
  passesLine,
  problemLine,
  rateLine,
  sampleLine,
  sectionsLine
} from "../../../../../tests/fixtures/fake-monitor";
import { flushTick } from "../../flush";
import { QUEUE_LINES } from "../../state";
import { kinds, queued, recorder, startupLine } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The listener: called inside the engine's commit; keeps references, never
// serializes, a bounded queue, and the context lines while idle.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

describe("the stream listener", () => {
  it("while recording queues the very object it got and serializes nothing (bug: a JSON.stringify inside the game's frame)", () => {
    const t = recorder();
    t.api.start();
    const sample = sampleLine(10);
    t.monitor.emit(sample);
    expect(queued(t.state).at(-1)).toBe(sample);
    expect(t.state.session?.lines).toBe(0);
    expect(t.state.session?.pending).toEqual([]);
  });

  it("a full queue drops its oldest reference and counts it (bug: an unbounded queue on a stalled timer)", () => {
    const t = recorder();
    t.api.start();
    const first = sampleLine(1);
    t.monitor.emit(first);
    for (let frame = 2; frame <= QUEUE_LINES; frame += 1) t.monitor.emit(sampleLine(frame));
    // header + start event + QUEUE_LINES samples: the two oldest went.
    expect(t.state.queueSize).toBe(QUEUE_LINES);
    expect(t.state.dropped).toBe(2);
    expect(queued(t.state)[0]).toBe(first);
  });

  it("while idle keeps only the newest header, startup and display, and queues nothing", () => {
    const t = recorder();
    const startup = startupLine();
    const display = eventLine("display", null, DISPLAY);
    t.monitor.emit(startup);
    t.monitor.emit(display);
    t.monitor.emit(sampleLine(3));
    t.monitor.emit(eventLine("scene", 4, { to: "garden" }));
    expect(t.state.queueSize).toBe(0);
    expect([t.state.header?.kind, t.state.startup, t.state.display]).toEqual([
      "header",
      startup,
      display
    ]);
    expect(kinds(queued(t.state))).toEqual([]);
  });

  it("while recording queues a line of an unknown kind and an event of an unknown name, and writes them byte-identical (bug: a future allow-list dropping the engine's additions)", () => {
    const t = recorder();
    t.api.start();
    const passes = passesLine();
    const problem = problemLine();
    t.monitor.emit(passes);
    t.monitor.emit(problem);
    expect(queued(t.state).slice(-2)).toEqual([passes, problem]);
    flushTick(t.ctx);
    expect(t.state.session?.pending.slice(-2)).toEqual([
      JSON.stringify(passes),
      JSON.stringify(problem)
    ]);
  });

  it("while idle keeps the newest rate, sections and debug lines, an older one replaced (bug: the context line of an old rate)", () => {
    const t = recorder();
    const rate = rateLine({ from: 60, to: 120, reason: "headroom" });
    const sections = sectionsLine({ on: [], off: ["passes"] });
    const debug = debugLine(false);
    for (const line of [rateLine(), sectionsLine(), debugLine(true), rate, sections, debug]) {
      t.monitor.emit(line);
    }
    expect([t.state.rate, t.state.sections, t.state.debug]).toEqual([rate, sections, debug]);
    expect(t.state.rate).toBe(rate);
    expect(t.state.queueSize).toBe(0);
  });
});
