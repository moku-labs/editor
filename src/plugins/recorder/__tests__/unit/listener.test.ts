/* eslint-disable unicorn/no-null -- null is "no input", "no header" and "between frames" of the engine */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISPLAY, eventLine, sampleLine } from "../../../../../tests/fixtures/fake-monitor";
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
});
