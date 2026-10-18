/* eslint-disable unicorn/no-null -- null is "no rows" on the wire */
import { describe, expect, it } from "vitest";
import type { PerfDetailWire } from "../../protocol";
import { feedRig } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// editor.perf.detail { from, to } (spec 03 Delta 2026-10-16 D8): the rows of a
// range from perf's own window, else "gone"; at most 2048 frames. Reading the
// engine's monitor.detail is deferred to the engine's next change (owner
// 2026-10-16).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * perf on a fake monitor with 40 frames (1–40) read, `detail` as asked.
 *
 * @param detail - How the monitor's `detail` behaves.
 * @returns The rig.
 */
function rig(detail: "control" | "absent") {
  const found = feedRig({}, { detail });
  for (let index = 0; index < 40; index += 1) {
    found.monitor.commit({ t: 1000 + index * 16.7, gapMs: 16.7, draws: 12 });
  }
  found.tick();
  return found;
}

/**
 * Reads the detail of a range.
 *
 * @param read - The rig's source read.
 * @param from - The first frame.
 * @param to - The last frame.
 * @returns The answer.
 */
function detailOf(
  read: (id: string, input?: { from: number; to: number }) => unknown,
  from: number,
  to: number
): PerfDetailWire {
  return read("editor.perf.detail", { from, to }) as PerfDetailWire;
}

describe("editor.perf.detail", () => {
  it("answers the window rows of the range with reason no-detail, the ends swapped when reversed (bug: a reversed selection answering nothing)", () => {
    const answer = detailOf(rig("absent").read, 12, 10);
    expect(answer).toMatchObject({
      v: 1,
      from: 10,
      to: 12,
      source: "agent",
      reason: "no-detail",
      nodes: null
    });
    expect(answer.frames?.frame).toEqual([10, 11, 12]);
    expect(answer.frames?.draws).toEqual([12, 12, 12]);
    expect(answer.frames?.hole).toBe(false);
  });

  it("does not call an engine's monitor.detail before its reading ships (bug: the phone allocating an answer perf throws away)", () => {
    const { read, monitor } = rig("control");
    expect(detailOf(read, 38, 45)).toMatchObject({ source: "agent", reason: "no-detail" });
    expect(monitor.controlCalls).toEqual([]);
  });

  it("answers frames null with reason gone for a range nobody holds any more (bug: an empty answer read as no frames at all)", () => {
    const { read, monitor, tick } = rig("absent");
    for (let index = 0; index < 400; index += 1) {
      monitor.commit({ t: 2000 + index * 16.7, gapMs: 16.7 });
    }
    tick();
    expect(detailOf(read, 1, 5)).toEqual({
      v: 1,
      from: 1,
      to: 5,
      source: null,
      reason: "gone",
      frames: null,
      nodes: null
    });
  });

  it("clamps a range over 2048 frames to its newest 2048 (bug: a selection that makes the phone build two minutes of rows)", () => {
    const answer = detailOf(rig("absent").read, 0, 10_000);
    expect([answer.from, answer.to]).toEqual([7952, 10_000]);
  });
});
