import { describe, expect, it } from "vitest";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { readTick } from "../../reader";
import { statusOf } from "../../records";
import { attach, commitFrames, perfState } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// reader: the read cycle — read after the cursor, append, trim, late GPU, spike
// index, scalars, version — inside the agent span.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A state with a fake monitor attached.
 *
 * @param frames - perf's frames.
 * @param windowMs - perf's window.
 * @param capacity - The ring's capacity.
 * @returns The perf, the monitor and a tick.
 */
function setup(frames = 1024, windowMs = 6000, capacity = 64) {
  const perf = perfState({ frames, windowMs });
  const monitor = createFakeMonitor({ capacity });
  attach(perf.state, monitor);
  const tick = () => readTick(perf.state, perf.config);
  return { ...perf, monitor, tick };
}

describe("readTick", () => {
  it("copies only the frames after the cursor (bug: the same frame drawn twice)", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 3, 1000, 16.7);
    tick();
    commitFrames(monitor, 2, 1050.1, 16.7);
    tick();
    expect(state.window.count).toBe(5);
    expect([...state.window.frame.subarray(0, 5)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not count older frames as lost at the first read, but counts a later overrun (bug: a lost 1000 warning at start)", () => {
    const { state, monitor, tick } = setup(64, 30_000, 256);
    commitFrames(monitor, 200, 0, 16.7);
    tick();
    expect(state.lost).toBe(0);
    expect([state.window.count, state.window.frame[0]]).toEqual([64, 137]);
    commitFrames(monitor, 100, 3340, 16.7);
    tick();
    expect(state.lost).toBe(36);
  });

  it("trims rows that started more than windowMs before the newest one", () => {
    const { state, monitor, tick } = setup(1024, 1000);
    commitFrames(monitor, 40, 0, 50);
    tick();
    const newest = state.window.t[state.window.count - 1] ?? 0;
    expect(state.window.t[0]).toBeGreaterThanOrEqual(newest - 1000);
    expect(state.window.count).toBe(21);
  });

  it("leaves the agent's own time out of jsMs (bug: the overlay's paint shown as game work)", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0, workMs: 5, agentMs: 2 });
    tick();
    expect(state.window.jsMs[0]).toBe(3);
  });

  it("takes the gap as the frame time of a late frame and js + gpu for a heavy one", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0, gapMs: 25.1, workMs: 3 });
    monitor.commit({ t: 25.1, gapMs: 16.7, workMs: 10, gpuMs: 12 });
    monitor.commit({ t: 41.8, capMs: 8.33, workMs: 2 });
    tick();
    expect(state.window.ms[0]).toBeCloseTo(25.1, 4);
    expect(state.window.ms[1]).toBeCloseTo(22, 4);
    expect(state.window.ms[2]).toBeCloseTo(8.33, 4);
  });

  it("keeps a frame that was not drawn, with drawn 0", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0 });
    monitor.commit({ t: 16.7, drawn: false });
    tick();
    expect([...state.window.drawn.subarray(0, 2)]).toEqual([1, 0]);
  });

  it("picks up a late GPU time and its gpu cause from the same slot, while the slot still holds the frame", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0, gapMs: 8.33, rateMs: 8.33, capMs: 8.33, gpuPartial: true });
    tick();
    expect([state.window.cause[0], state.window.spikeCount]).toEqual([0, 0]);
    monitor.landGpu(1, 12, 0b100);
    const version = state.window.version;
    tick();
    expect(state.window.gpuMs[0]).toBe(12);
    expect([state.window.cause[0], state.window.spikeCount]).toEqual([1, 1]);
    expect(state.window.ms[0]).toBeCloseTo(15, 4);
    expect(state.window.version).toBe(version + 1);
  });

  it("leaves a partial row alone once its slot holds another frame (bug: the GPU time of another frame)", () => {
    const { state, monitor, tick } = setup(1024, 30_000, 4);
    monitor.commit({ t: 0, gpuPartial: true });
    tick();
    commitFrames(monitor, 4, 16.7, 16.7, { gpuMs: 30, causes: 0b100 });
    tick();
    expect(Number.isNaN(state.window.gpuMs[0])).toBe(true);
    expect(state.window.cause[0]).toBe(0);
    expect(state.window.frame[0]).toBe(1);
  });

  it("drops the oldest quarter of a full window before appending", () => {
    const { state, monitor, tick } = setup(64, 30_000, 128);
    commitFrames(monitor, 64, 0, 16.7);
    tick();
    monitor.commit({ t: 64 * 16.7 });
    tick();
    expect(state.window.count).toBe(49);
    expect(state.window.frame[0]).toBe(17);
    expect(state.window.frame[48]).toBe(65);
  });

  it("does not read a ring of capacity 0 and reports waiting", () => {
    const { state, monitor, tick } = setup(1024, 6000, 0);
    const begins = monitor.begins;
    tick();
    expect([monitor.reads, monitor.begins - begins]).toEqual([0, 0]);
    expect(statusOf(state)).toEqual({ state: "waiting" });
  });

  it("brackets every tick with beginAgent and endAgent, also when read throws (bug: an open agent span hiding every spike)", () => {
    const { monitor, tick } = setup();
    const before = monitor.begins;
    expect(monitor.ends).toBe(before);
    tick();
    expect([monitor.begins - before, monitor.ends - before]).toEqual([1, 1]);
    monitor.failRead = new Error("ring torn");
    expect(tick).toThrow("ring torn");
    expect([monitor.begins - before, monitor.ends - before]).toEqual([2, 2]);
  });

  it("does not move version on a tick that read nothing (bug: a 4 Hz repaint of an unchanged graph)", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 3, 0, 16.7);
    tick();
    const version = state.window.version;
    tick();
    expect(state.window.version).toBe(version);
  });

  it("indexes the spikes and sets the scalars: the axis, fps of the last second", () => {
    const { state, monitor, tick } = setup(1024, 6000, 128);
    commitFrames(monitor, 70, 0, 16.7);
    monitor.commit({ t: 70 * 16.7, gapMs: 25.1, causes: 0b1 });
    monitor.commit({ t: 70 * 16.7 + 25.1, drawn: false });
    tick();
    const { window } = state;
    const newest = window.count - 1;
    expect([window.spikeCount, window.spikes[0]]).toEqual([1, 70]);
    expect(window.endMs).toBeCloseTo((window.t[newest] ?? 0) + (window.ms[newest] ?? 0), 4);
    expect(window.startMs).toBeCloseTo(window.endMs - 6000, 4);
    expect([state.fpsLoop, state.fpsDrawn]).toEqual([60, 59]);
    expect(statusOf(state)).toEqual({ state: "on", lost: 0, gpuTimer: true });
  });
  it("fills a missing rate from the row before, else 16.67, and reads an unmeasured agent time as 0 (bug: a rate switch drawn at every hole of the ring)", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0, rateMs: 0, agentMs: Number.NaN, workMs: 4 });
    monitor.commit({ t: 16.7, rateMs: 8.33 });
    monitor.commit({ t: 25, rateMs: Number.NaN });
    tick();
    const { rateMs, budgetMs, jsMs } = state.window;
    expect([rateMs[0], budgetMs[0], jsMs[0]]).toEqual([Math.fround(16.67), Math.fround(16.67), 4]);
    expect([rateMs[1], rateMs[2], budgetMs[2]]).toEqual([
      Math.fround(8.33),
      Math.fround(8.33),
      Math.fround(8.33)
    ]);
  });

  it("leaves a partial row alone when its slot holds another frame inside the ring (an engine restart)", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0, gpuPartial: true });
    tick();
    const { columns } = monitor.frames();
    columns.frame[0] = 77;
    columns.gpuMs[0] = 30;
    columns.causes[0] = 0b100;
    columns.gpuPartial[0] = 0;
    tick();
    expect(Number.isNaN(state.window.gpuMs[0])).toBe(true);
    expect(state.window.cause[0]).toBe(0);
  });

  it("starts over when the engine rebuilt its ring (bug: perf blind until the new ring passes the old cursor)", () => {
    const { state, config, monitor, tick } = setup();
    commitFrames(monitor, 10, 0, 16.7);
    tick();
    const rebuilt = createFakeMonitor({ capacity: 128 });
    commitFrames(rebuilt, 3, 500, 16.7);
    state.monitor = rebuilt;
    const version = state.window.version;
    readTick(state, config);
    expect(state.window.count).toBe(3);
    expect([...state.window.frame.subarray(0, 3)]).toEqual([1, 2, 3]);
    expect(state.window.version).toBe(version + 1);
  });

  it("does nothing without a monitor", () => {
    const { state, config } = perfState();
    expect(() => readTick(state, config)).not.toThrow();
    expect([state.window.version, state.measuring]).toEqual([0, false]);
  });
  it("picks up a late GPU time after the engine's stop and start (fix A: frame k stays in slot k % capacity)", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 3, 0, 16.7);
    tick();
    monitor.restart();
    const frame = monitor.commit({ t: 100, gpuPartial: true });
    tick();
    monitor.landGpu(frame, 30, 0b100);
    tick();
    expect(state.window.gpuMs[3]).toBe(30);
    expect(state.window.cause[3]).toBe(1);
  });

  it("picks up a late GPU time after an engine before fix A reset its ring to slot 0 and kept counting frames", () => {
    const { state, config } = perfState();
    const monitor = createFakeMonitor({ legacyReset: true });
    attach(state, monitor);
    commitFrames(monitor, 3, 0, 16.7);
    readTick(state, config);
    monitor.restart();
    const frame = monitor.commit({ t: 100, gpuPartial: true });
    readTick(state, config);
    expect(monitor.frames().columns.frame[0]).toBe(frame);
    monitor.landGpu(frame, 30, 0b100);
    readTick(state, config);
    expect(state.window.gpuMs[3]).toBe(30);
    expect(state.window.cause[3]).toBe(1);
  });

  it("answers fps 0 for an empty window after the engine rebuilt its ring (bug: a stale fps on an empty graph)", () => {
    const { state, config, monitor, tick } = setup();
    commitFrames(monitor, 30, 0, 16.7);
    tick();
    expect(state.fpsLoop).toBe(30);
    state.monitor = createFakeMonitor({ capacity: 128 });
    readTick(state, config);
    expect([state.window.count, state.fpsLoop, state.fpsDrawn]).toEqual([0, 0, 0]);
  });
});
