import { describe, expect, it } from "vitest";
import { commitFrames, feedRig } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// feeds/passes readPasses (spec 03 Delta 2026-10-16 D5): the engine's pass ring
// copied into perf's pass window with its own cursor, in the read's agent span,
// trimmed with the frame window, the late pass GPU taken from the same slot only,
// and only while feeds.passes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The frames of the pass window's rows, oldest first.
 *
 * @param passes - The pass window.
 * @param passes.frame - Its frame column.
 * @param passes.count - Its rows.
 * @returns The frames.
 */
function framesOf(passes: { frame: Uint32Array; count: number }): number[] {
  return [...passes.frame.subarray(0, passes.count)];
}

describe("readPasses", () => {
  it("copies only the passes after its cursor, in ring order (bug: a pass counted twice and a chain's applies doubled)", () => {
    const { state, monitor, tick } = feedRig({ feedPasses: true });
    commitFrames(monitor, 2, 1000, 16.7);
    monitor.commitPass({ frame: 1 });
    monitor.commitPass({ frame: 1, kind: "filter", owner: 412, filter: "fog.blur" });
    monitor.commitPass({ frame: 2 });
    tick();
    monitor.commit({ t: 1033.4, gapMs: 16.7 });
    monitor.commitPass();
    tick();
    tick();

    expect(framesOf(state.passes)).toEqual([1, 1, 2, 3]);
    expect([...state.passes.index.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
    expect(state.passesLost).toBe(0);
  });

  it("waits for the frame of a pass: a pass of a frame not committed yet is read with its frame (bug: a pass without its frame row, its GPU never refreshed)", () => {
    const { state, monitor, tick } = feedRig({ feedPasses: true });
    monitor.commit({ t: 0 });
    monitor.commitPass({ frame: 2 });
    tick();
    expect(state.passes.count).toBe(0);
    monitor.commit({ t: 16.7, gapMs: 16.7 });
    tick();
    expect(framesOf(state.passes)).toEqual([2]);
  });

  it("takes a late pass GPU only while its slot still holds the pass of the same frame (bug: another frame's pass time)", () => {
    const { state, monitor, tick } = feedRig({ feedPasses: true }, { capacity: 4 });
    monitor.commit({ t: 0, gpuPartial: true });
    const first = monitor.commitPass();
    tick();
    expect(state.passes.gpuMs[0]).toBeNaN();

    monitor.landPassGpu(first, 3.5);
    tick();
    expect(state.passes.gpuMs[0]).toBeCloseTo(3.5);

    // Slot 0 is written again by a pass of frame 2, then a time lands there: not frame 1's.
    monitor.commit({ t: 16.7, gapMs: 16.7 });
    for (let index = 0; index < 16; index += 1) monitor.commitPass({ index });
    monitor.ring.passes.gpuMs[0] = 9;
    tick();
    expect(framesOf(state.passes).slice(0, 2)).toEqual([1, 2]);
    expect(state.passes.gpuMs[0]).toBeCloseTo(3.5);
  });

  it("drops the passes of frames the window no longer holds (bug: the lane shows passes of frames gone from the window)", () => {
    const { state, monitor, tick } = feedRig({ feedPasses: true, windowMs: 1000 });
    monitor.commit({ t: 0 });
    monitor.commitPass();
    monitor.commitPass();
    tick();
    expect(state.passes.count).toBe(2);
    commitFrames(monitor, 100, 20, 20);
    monitor.commitPass();
    tick();
    expect(framesOf(state.passes)).toEqual([101]);
  });

  it("reads nothing while feeds.passes is off, and a switch-on starts at the ring's oldest held pass inside the window, losing none (bug: a switch-on that dumps 4096 stale passes as new)", async () => {
    const { state, monitor, tick, command } = feedRig({ windowMs: 1000 }, { capacity: 64 });
    for (let index = 0; index < 120; index += 1) {
      monitor.commit({ t: index * 16.7, gapMs: 16.7 });
      monitor.commitPass();
    }
    tick();
    expect(state.passes.count).toBe(0);

    await command("editor.perf.sections").run({ passes: true });
    monitor.commit({ t: 120 * 16.7, gapMs: 16.7 });
    monitor.commitPass();
    tick();

    const { window } = state;
    expect(state.passes.frame[0]).toBe(window.frame[0]);
    expect(state.passes.count).toBe(window.count);
    expect(state.passesLost).toBe(0);
  });

  it("counts the passes the ring overwrote before a read (bug: silent pass loss)", () => {
    const { state, monitor, tick } = feedRig({ feedPasses: true }, { capacity: 4 });
    monitor.commit({ t: 0 });
    monitor.commitPass();
    tick();
    monitor.commit({ t: 16.7, gapMs: 16.7 });
    for (let index = 0; index < 20; index += 1) monitor.commitPass({ index });
    tick();
    expect(state.passesLost).toBe(4);
    expect(state.passes.count).toBe(17);
  });
});
