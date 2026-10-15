/* eslint-disable unicorn/no-null -- null is "the display rate is not known" */
import { describe, expect, it } from "vitest";
import {
  createFakeMonitor,
  DISPLAY,
  eventLine,
  headerLine,
  rateChange
} from "../../../../../tests/fixtures/fake-monitor";
import type { Json } from "../../../registry/protocol";
import { primaryCause, rowOfFrame } from "../../protocol";
import { readTick } from "../../reader";
import { secondOf, statusOf } from "../../records";
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

  it("picks up a late GPU time and its gpu cause from the same slot, while the slot still holds the frame (alone: noise)", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0, gapMs: 8.33, rateMs: 8.33, capMs: 8.33, gpuPartial: true });
    tick();
    expect([state.window.cause[0], state.window.spikeCount]).toEqual([0, 0]);
    monitor.landGpu(1, 12, 0b100);
    const version = state.window.version;
    tick();
    expect(state.window.gpuMs[0]).toBe(12);
    expect([state.window.noise[0], state.window.cause[0], state.window.spikeCount]).toEqual([
      0b100, 0, 0
    ]);
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
    monitor.commit({ t: 70 * 16.7, gapMs: 25.1, workMs: 30, causes: 0b11 });
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
    expect(state.window.noise[3]).toBe(0b100);
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
    expect(state.window.noise[3]).toBe(0b100);
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

  it("marks resting rows (the engine's idle frames, on-demand frames it did not draw) and the wake after them; a rest's budget is its cap", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0 });
    monitor.commit({ t: 33.4, gapMs: 33.4, capMs: 33.33, idle: true });
    monitor.commit({ t: 50.1, gapMs: 16.7, drawn: false, reason: 11 });
    monitor.commit({ t: 66.8, gapMs: 16.7, drawn: false });
    tick();
    expect([...state.window.rest.subarray(0, 4)]).toEqual([0, 1, 1, 2]);
    expect(state.window.budgetMs[1]).toBeCloseTo(33.33, 4);
  });

  it("never spikes a resting frame or the wake after it on the engine's gap (bug: a spike per second on a still screen)", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0 });
    monitor.commit({ t: 500, gapMs: 500, drawn: false, reason: 11, causes: 0b1 });
    monitor.commit({ t: 1000, gapMs: 500, idle: true, causes: 0b1 });
    monitor.commit({ t: 1033.4, gapMs: 33.4, causes: 0b1 });
    tick();
    expect(state.window.spikeCount).toBe(0);
    expect([...state.window.causes.subarray(1, 4)]).toEqual([1, 1, 1]);
  });

  it("never makes a pause without work a spike; a workless gap of 900 ms or more is a break (bug: GAP noise, browser throttling)", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0 });
    monitor.commit({ t: 40, gapMs: 40, causes: 0b1 });
    monitor.commit({ t: 100, gapMs: 60, causes: 0b1 });
    monitor.commit({ t: 1101, gapMs: 1001, causes: 0b1 });
    monitor.commit({ t: 1201, gapMs: 100, workMs: 30, causes: 0b11 });
    tick();
    expect([...state.window.causes.subarray(1, 4)]).toEqual([1, 1, 1]);
    expect([...state.window.rest.subarray(0, 5)]).toEqual([0, 0, 0, 3, 0]);
    expect([state.window.spikeCount, state.window.spikes[0], state.window.cause[4]]).toEqual([
      1,
      4,
      primaryCause(0b10)
    ]);
  });

  it("judges by work on the frame's own budget, and clears the gap bit of a vsync gap under the display's frame (bug: every vsync over an 8.3 ms budget at 120 fps on 60 Hz)", () => {
    const rate = {
      fps: 120,
      mode: "auto",
      reason: "display",
      displayHz: 60,
      ladder: [120, 60],
      thermal: null
    } as const;
    const perf = perfState();
    const monitor = createFakeMonitor({ header: headerLine({ rate }) });
    attach(perf.state, monitor);
    monitor.commit({ t: 0, rateMs: 8.33, capMs: 8.33 });
    monitor.commit({ t: 16.7, gapMs: 16.7, rateMs: 8.33, capMs: 8.33, causes: 0b1 });
    monitor.commit({ t: 34.4, gapMs: 17.7, rateMs: 8.33, capMs: 8.33, workMs: 9, causes: 0b11 });
    readTick(perf.state, perf.config);
    expect([...perf.state.window.causes.subarray(1, 3)]).toEqual([0, 0b10]);
    expect([perf.state.window.spikeCount, perf.state.window.cause[2]]).toEqual([
      1,
      primaryCause(0b10)
    ]);
  });

  it("decodes the ring's cause bits with the engine's PERF_CAUSES: a bit the engine does not name is dropped from the window", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0 });
    monitor.commit({ t: 16.7, gapMs: 16.7, workMs: 30, causes: 0b1000_0010 });
    tick();
    expect([state.window.causes[1], state.window.cause[1]]).toEqual([0b10, primaryCause(0b10)]);
  });

  it("decodes the causes of a late GPU result with PERF_CAUSES too (an unnamed bit is dropped)", () => {
    const { state, monitor, tick } = setup();
    const frame = monitor.commit({ t: 0, gpuPartial: true });
    tick();
    monitor.landGpu(frame, 0.5, 0b1000_0000);
    tick();
    expect([state.window.gpuMs[0], state.window.causes[0]]).toEqual([0.5, 0]);
  });

  it("never flags a frame rendered on demand that drew nothing, even with work on it (bug: 78 of 79 spikes on a still on-demand screen)", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0 });
    monitor.commit({ t: 16.7, gapMs: 16.7, drawn: false, reason: 11, workMs: 30, causes: 0b10 });
    tick();
    expect(state.window.spikeCount).toBe(0);
  });

  it("counts the fps of the last second over awake frames only (bug: loop 2 fps on a sleeping screen)", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 30, 0, 16.7);
    commitFrames(monitor, 40, 500.1, 33.4, { idle: true, capMs: 33.33 });
    tick();
    expect([state.fpsLoop, state.fpsDrawn]).toEqual([0, 0]);
  });
});

/** The gpu cause bit. */
const GPU = 0b100;

/** The js cause bit. */
const JS = 0b10;

describe("readTick: the GPU noise rule (spec 03 delta item 8)", () => {
  it("makes a lone over-budget GPU a faint GPU tick, not a spike (bug: a 17-25 ms reading at a 0.49 ms p50 flagged on Apple/Mali)", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 3, 0, 16.7, { gpuMs: 0.5 });
    monitor.commit({ t: 50.1, gapMs: 16.7, gpuMs: 22, causes: GPU });
    commitFrames(monitor, 3, 66.8, 16.7, { gpuMs: 0.5 });
    tick();
    expect([state.window.noise[3], state.window.causes[3], state.window.cause[3]]).toEqual([
      GPU,
      0,
      0
    ]);
    expect(state.window.spikeCount).toBe(0);
  });

  it("flags both frames when the GPU is over budget on 2 of 3 consecutive drawn frames", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0, gpuMs: 0.5 });
    monitor.commit({ t: 16.7, gapMs: 16.7, gpuMs: 21, causes: GPU });
    monitor.commit({ t: 33.4, gapMs: 16.7, drawn: false });
    monitor.commit({ t: 50.1, gapMs: 16.7, gpuMs: 0.5 });
    monitor.commit({ t: 66.8, gapMs: 16.7, gpuMs: 24, causes: GPU });
    tick();
    expect([state.window.spikeCount, state.window.spikes[0], state.window.spikes[1]]).toEqual([
      2, 1, 4
    ]);
    expect([state.window.cause[1], state.window.noise[1], state.window.noise[4]]).toEqual([
      primaryCause(GPU),
      0,
      0
    ]);
  });

  it("decides on the late GPU result: the second over-budget GPU to land promotes the first", () => {
    const { state, monitor, tick } = setup();
    const frames = commitFrames(monitor, 4, 0, 16.7, { gpuPartial: true });
    tick();
    monitor.landGpu(frames[0] ?? 0, 20, GPU);
    tick();
    expect([state.window.noise[0], state.window.spikeCount]).toEqual([GPU, 0]);
    const version = state.window.version;
    monitor.landGpu(frames[2] ?? 0, 19, GPU);
    tick();
    expect([state.window.spikeCount, state.window.cause[0], state.window.cause[2]]).toEqual([
      2, 1, 1
    ]);
    expect([state.window.noise[0], state.window.noise[2]]).toEqual([0, 0]);
    expect(state.window.version).toBe(version + 1);
    monitor.landGpu(frames[3] ?? 0, 0.6);
    tick();
    expect([state.window.cause[0], state.window.causes[0]]).toEqual([1, GPU]);
  });

  it("keeps a counted GPU counted while its frame stays partial, without a new version at each read (bug: a spike blinking to noise)", () => {
    const { state, monitor, tick } = setup();
    monitor.commit({ t: 0, gpuMs: 20, causes: GPU, gpuPartial: true });
    monitor.commit({ t: 16.7, gapMs: 16.7, gpuMs: 21, causes: GPU });
    tick();
    expect([state.window.cause[0], state.window.cause[1]]).toEqual([1, 1]);
    const version = state.window.version;
    tick();
    expect([state.window.version, state.window.cause[0], state.window.noise[0]]).toEqual([
      version,
      1,
      0
    ]);
  });

  it("keeps a lone outlier's noise on its frame when the window drops its oldest rows", () => {
    const { state, monitor, tick } = setup(1024, 1000);
    const frames = commitFrames(monitor, 40, 0, 50, { gpuMs: 0.5 });
    monitor.landGpu(frames[30] ?? 0, 22, GPU);
    tick();
    const row = rowOfFrame(state.window, frames[30] ?? 0);
    expect(row).toBeLessThan(30);
    const noisy = [...state.window.noise.subarray(0, state.window.count)].flatMap((noise, index) =>
      noise === 0 ? [] : [index]
    );
    expect(noisy).toEqual([row]);
  });

  it("keeps a JS spike with a lone GPU outlier a JS spike (bug: the noise ranked first, as the cause)", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 3, 0, 16.7, { gpuMs: 0.5 });
    monitor.commit({ t: 50.1, gapMs: 16.7, workMs: 30, gpuMs: 23, causes: GPU | JS });
    tick();
    expect([state.window.cause[3], state.window.noise[3]]).toEqual([primaryCause(JS), GPU]);
  });

  it("writes the window's GPU p50 and p90 at every read, over the drawn frames with a measured GPU", () => {
    const { state, monitor, tick } = setup();
    for (let index = 0; index < 10; index += 1) {
      monitor.commit({ t: index * 16.7, gapMs: 16.7, gpuMs: index + 1 });
    }
    monitor.commit({ t: 167, gapMs: 16.7, gpuMs: 80, drawn: false });
    tick();
    expect([state.window.gpuP50Ms, state.window.gpuP90Ms]).toEqual([5, 9]);
    monitor.commit({ t: 183.7, gapMs: 16.7, gpuMs: 25, causes: GPU });
    tick();
    expect([state.window.gpuP50Ms, state.window.gpuP90Ms]).toEqual([6, 10]);
  });
});

/**
 * A game whose time.rate() answers a display rate, its renderer holding the monitor.
 *
 * @param state - perf's state, already attached.
 * @param displayHz - What time.rate().displayHz answers.
 */
function withRate(state: ReturnType<typeof setup>["state"], displayHz: number): void {
  const renderer = { monitor: state.monitor };
  state.game = { renderer, time: { rate: () => ({ fps: 120, displayHz }) } } as never;
}

/**
 * The default display with the Hz a newer engine announces in it.
 *
 * @param hz - The display's Hz.
 * @returns The display, as the engine's event detail.
 */
function displayWith(hz: unknown): Readonly<Record<string, Json>> {
  return { ...DISPLAY, hz } as Readonly<Record<string, Json>>;
}

describe("readTick: the display's Hz", () => {
  it("prefers the display's announced hz (header display.hz) over time.rate().displayHz", () => {
    const perf = perfState();
    const display = displayWith(60) as unknown as typeof DISPLAY;
    const monitor = createFakeMonitor({ header: headerLine({ display }) });
    attach(perf.state, monitor);
    expect(perf.state.displayHz).toBe(60);
    withRate(perf.state, 120);
    monitor.commit({ t: 0, rateMs: 8.33, capMs: 8.33 });
    monitor.commit({ t: 17.7, gapMs: 17.7, rateMs: 8.33, capMs: 8.33, causes: 0b1 });
    readTick(perf.state, perf.config);
    expect(perf.state.displayHz).toBe(60);
    expect(secondOf(perf.state).rate.displayHz).toBe(60);
    expect(perf.state.window.causes[1]).toBe(0);
  });

  it("reads time.rate().displayHz while the display announces no hz (an engine before the display hz)", () => {
    const { state, monitor, tick } = setup();
    withRate(state, 120);
    monitor.commit({ t: 0, rateMs: 8.33, capMs: 8.33 });
    monitor.commit({ t: 17.7, gapMs: 17.7, rateMs: 8.33, capMs: 8.33, causes: 0b1 });
    tick();
    expect(state.displayHz).toBe(120);
    expect(state.window.causes[1]).toBe(0b1);
  });

  it("takes a new hz from a display event (the engine's event on a display rate change), over time.rate() and rate lines", () => {
    const { state, monitor, tick } = setup();
    withRate(state, 120);
    monitor.emit(eventLine("display", 3, displayWith(60)));
    expect(state.displayHz).toBe(60);
    monitor.emit(eventLine("rate", 4, rateChange({ displayHz: 120 }) as never));
    expect(state.displayHz).toBe(60);
    tick();
    expect(state.displayHz).toBe(60);
    monitor.emit(eventLine("display", 5, displayWith(90)));
    expect(state.displayHz).toBe(90);
  });

  it("ignores an announced hz that is not a positive number", () => {
    const { state, monitor, tick } = setup();
    withRate(state, 120);
    monitor.emit(eventLine("display", 3, displayWith(0)));
    monitor.emit(eventLine("display", 4, displayWith("60")));
    tick();
    expect(state.displayHz).toBe(120);
  });
});
