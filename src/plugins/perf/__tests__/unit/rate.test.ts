/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's lines and perf's values */
import { describe, expect, it } from "vitest";
import {
  createFakeMonitor,
  eventLine,
  headerLine,
  rateChange
} from "../../../../../tests/fixtures/fake-monitor";
import { rateFps } from "../../protocol";
import { readTick } from "../../reader";
import { secondOf, spikeRecord, spikeSummaries } from "../../records";
import { attach, commitFrames, perfState } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// rateFps: one frame of the loop's rate (the ring's rateMs) as frames a second.
// ─────────────────────────────────────────────────────────────────────────────

describe("rateFps", () => {
  it("reads 8.33 ms as 120 fps and 16.67 ms as 60 fps", () => {
    expect(rateFps(8.33)).toBe(120);
    expect(rateFps(16.67)).toBe(60);
  });

  it("answers 0 for a value that is not a finite number above 0 (a ring before rateMs)", () => {
    expect([0, -8.33, Number.NaN, Number.POSITIVE_INFINITY].map(value => rateFps(value))).toEqual([
      0, 0, 0, 0
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The per-frame budget and the loop's rate: every row carries its own budgetMs
// and rateMs; second().rate and a record's rateSwitch follow the rate events.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A state with a fake monitor attached, read by `tick`.
 *
 * @param options - The fake monitor's options.
 * @returns The perf, the monitor and a tick.
 */
function setup(options: Parameters<typeof createFakeMonitor>[0] = {}) {
  const perf = perfState();
  const monitor = createFakeMonitor({ capacity: 256, ...options });
  attach(perf.state, monitor);
  return { ...perf, monitor, tick: () => readTick(perf.state, perf.config) };
}

describe("the per-frame budget and the rate", () => {
  it("falls back from 120 to 60: second().budgetMs is 16.67 and the rate reads 60 with one switch (bug: the 8.3 ms line kept after the fall back)", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 30, 0, 8.33, { rateMs: 8.33, capMs: 8.33 });
    commitFrames(monitor, 30, 250, 16.67, { rateMs: 16.67 });
    tick();
    const second = secondOf(state);
    expect(second.budgetMs).toBe(16.67);
    expect(second.rate).toMatchObject({ fps: 60, switches: 1 });
  });

  it("judges a spike by its own row's budget (bug: a 12 ms frame at 120 fps counted as fine)", () => {
    const { state, config, monitor, tick } = setup();
    commitFrames(monitor, 5, 0, 8.33, { rateMs: 8.33, capMs: 8.33 });
    monitor.commit({ t: 41.65, gapMs: 8.33, rateMs: 8.33, capMs: 8.33, workMs: 12, causes: 0b10 });
    commitFrames(monitor, 5, 53.65, 16.67, { rateMs: 16.67 });
    tick();
    const [spike] = spikeSummaries(state, config);
    expect(spike).toMatchObject({ budgetMs: 8.33, ms: 12, overMs: 3.67, cause: "js" });
  });

  it("keeps a fixed 16.7 budget at 120 fps while rateFps reads 120 (bug: a budget line drawn from the rate)", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 10, 0, 8.33, { rateMs: 8.33, capMs: 8.33, budgetMs: 16.7 });
    tick();
    const { window } = state;
    expect([...window.budgetMs.subarray(0, 10)].every(value => Math.abs(value - 16.7) < 1e-4)).toBe(
      true
    );
    expect(rateFps(window.rateMs[9] ?? 0)).toBe(120);
    expect(secondOf(state).budgetMs).toBe(16.7);
  });

  it("falls back to each row's rateMs on a ring without the budgetMs column (bug: no budget line on an engine before the addendum)", () => {
    const { state, monitor, tick } = setup({ budgetColumn: false });
    commitFrames(monitor, 3, 0, 8.33, { rateMs: 8.33, capMs: 8.33, budgetMs: 99 });
    commitFrames(monitor, 3, 25, 16.67, { rateMs: 16.67, budgetMs: 99 });
    tick();
    expect(state.window.budgetMs[0]).toBeCloseTo(8.33, 4);
    expect(state.window.budgetMs[5]).toBeCloseTo(16.67, 4);
  });

  it("reads mode, reason and display Hz from a rate event, and the record's rateSwitch with its reason", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 3, 0, 8.33, { rateMs: 8.33, capMs: 8.33 });
    const switched = monitor.commit({ t: 25, gapMs: 40, rateMs: 16.67, causes: 0b1 });
    monitor.emit(eventLine("rate", switched, rateChange()));
    tick();
    expect(secondOf(state).rate).toEqual({
      fps: 60,
      mode: "auto",
      reason: "missed",
      displayHz: 120,
      switches: 1
    });
    expect(spikeRecord(state, switched)?.rateSwitch).toEqual({
      from: 120,
      to: 60,
      reason: "missed",
      mode: "auto"
    });
  });

  it("takes reason and mode from a rate line written between frames (frame null) that leads into the switch (bug: a game.frameRate switch shown without its reason)", () => {
    const { state, monitor, tick } = setup();
    const origin = headerLine().timeOrigin;
    commitFrames(monitor, 3, 0, 8.33, { rateMs: 8.33, capMs: 8.33 });
    const change = rateChange({ reason: "forced", mode: "forced" });
    monitor.emit({ ...eventLine("rate", null, change), t: origin + 20 });
    const switched = monitor.commit({ t: 25, gapMs: 40, rateMs: 16.67, causes: 0b1 });
    tick();
    expect(spikeRecord(state, switched)?.rateSwitch).toEqual({
      from: 120,
      to: 60,
      reason: "forced",
      mode: "forced"
    });
  });

  it("does not take a frame-null rate line from before the row before, or of another switch", () => {
    const { state, monitor, tick } = setup();
    const origin = headerLine().timeOrigin;
    monitor.emit({
      ...eventLine("rate", null, rateChange({ reason: "forced", mode: "forced" })),
      t: origin - 50
    });
    commitFrames(monitor, 3, 0, 8.33, { rateMs: 8.33, capMs: 8.33 });
    monitor.emit({ ...eventLine("rate", null, rateChange({ from: 60, to: 30 })), t: origin + 20 });
    const switched = monitor.commit({ t: 25, gapMs: 40, rateMs: 16.67, causes: 0b1 });
    tick();
    expect(spikeRecord(state, switched)?.rateSwitch).toEqual({
      from: 120,
      to: 60,
      reason: null,
      mode: null
    });
  });

  it("shows a switch the rows show without reason and mode when no rate line names it", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 3, 0, 8.33, { rateMs: 8.33, capMs: 8.33 });
    const switched = monitor.commit({ t: 25, gapMs: 40, rateMs: 16.67, causes: 0b1 });
    tick();
    expect(spikeRecord(state, switched)?.rateSwitch).toEqual({
      from: 120,
      to: 60,
      reason: null,
      mode: null
    });
  });

  it("ignores a malformed rate detail", () => {
    const { state, monitor, tick } = setup();
    commitFrames(monitor, 3, 0, 16.67);
    monitor.emit(eventLine("rate", 2, { from: 120, to: 60, reason: "because" }));
    tick();
    expect(secondOf(state).rate).toMatchObject({ mode: null, reason: null, displayHz: null });
  });

  it("fills mode from a header with rate and no event, and leaves it null on a block-2b header", () => {
    const rate = {
      fps: 120,
      mode: "auto",
      reason: "start",
      displayHz: 120,
      ladder: [120, 60],
      thermal: null
    } as const;
    const withRate = setup({ header: headerLine({ rate }) });
    commitFrames(withRate.monitor, 3, 0, 8.33, { rateMs: 8.33 });
    withRate.tick();
    expect(secondOf(withRate.state).rate).toEqual({
      fps: 120,
      mode: "auto",
      reason: "start",
      displayHz: 120,
      switches: 0
    });

    const blockTwoB = setup();
    commitFrames(blockTwoB.monitor, 3, 0, 8.33, { rateMs: 8.33 });
    blockTwoB.tick();
    expect(secondOf(blockTwoB.state).rate.mode).toBeNull();
  });
});
