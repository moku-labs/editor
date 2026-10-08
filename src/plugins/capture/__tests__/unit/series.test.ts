/* eslint-disable unicorn/no-null -- null is the wire value the door answers when inert */
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserClock, lateCeilingMs, planSeries, recordSeries, stopSeries } from "../../series";
import type { SeriesRun } from "../../types";
import {
  CONFIG,
  createDeps,
  ENVELOPE,
  fakeClock,
  fakeRegistry,
  PNG,
  rejectionOf,
  thrownBy
} from "../helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("planSeries", () => {
  it.each([
    [2000, 100, 20],
    [20_000, 16, 1250],
    [50, 100, 1],
    [100, 30, 3]
  ])("plans %d ms at %d ms as %d shots", (durationMs, intervalMs, count) => {
    expect(planSeries({ durationMs, intervalMs }, CONFIG)).toEqual({
      count,
      durationMs,
      intervalMs
    });
  });

  it.each([
    [
      { durationMs: 0, intervalMs: 100 },
      "durationMs",
      "[moku-editor] editor.series: durationMs must be a positive number.\n  Pass the length of the series in milliseconds."
    ],
    [
      { durationMs: -5, intervalMs: 100 },
      "durationMs",
      "[moku-editor] editor.series: durationMs must be a positive number.\n  Pass the length of the series in milliseconds."
    ],
    [
      { durationMs: Number.NaN, intervalMs: 100 },
      "durationMs",
      "[moku-editor] editor.series: durationMs must be a positive number.\n  Pass the length of the series in milliseconds."
    ],
    [
      { durationMs: 20_001, intervalMs: 100 },
      "durationMs",
      "[moku-editor] editor.series: durationMs must be at most 20000.\n  Record a shorter series."
    ],
    [
      { durationMs: 1000, intervalMs: 15 },
      "intervalMs",
      "[moku-editor] editor.series: intervalMs must be at least 16.\n  One frame is the shortest interval."
    ],
    [
      { durationMs: 1000, intervalMs: Number.POSITIVE_INFINITY },
      "intervalMs",
      "[moku-editor] editor.series: intervalMs must be at least 16.\n  One frame is the shortest interval."
    ]
  ])("refuses %o with -32602 naming %s", (input, field, message) => {
    expect(thrownBy(() => planSeries(input, CONFIG))).toMatchObject({
      code: -32_602,
      message,
      data: { reason: "invalid_input", id: "editor.series", field }
    });
  });

  it("reads the limits from the config", () => {
    const config = { maxDurationMs: 5000, minIntervalMs: 50 };

    expect(thrownBy(() => planSeries({ durationMs: 6000, intervalMs: 100 }, config))).toMatchObject(
      {
        message:
          "[moku-editor] editor.series: durationMs must be at most 5000.\n  Record a shorter series.",
        data: { field: "durationMs" }
      }
    );
    expect(thrownBy(() => planSeries({ durationMs: 1000, intervalMs: 40 }, config))).toMatchObject({
      message:
        "[moku-editor] editor.series: intervalMs must be at least 50.\n  One frame is the shortest interval.",
      data: { field: "intervalMs" }
    });
  });
});

describe("recordSeries", () => {
  it("takes the planned shots on schedule, each with its real frame", async () => {
    const clock = fakeClock();
    const deps = createDeps(clock);
    const registry = fakeRegistry();

    const result = await recordSeries(
      planSeries({ durationMs: 500, intervalMs: 100 }, CONFIG),
      registry,
      deps
    );

    expect(result.shots).toEqual([
      { image: PNG, frame: 1778, atMs: 0 },
      { image: PNG, frame: 1779, atMs: 100 },
      { image: PNG, frame: 1780, atMs: 200 },
      { image: PNG, frame: 1781, atMs: 300 },
      { image: PNG, frame: 1782, atMs: 400 }
    ]);
    expect(result.state).toEqual({ ...ENVELOPE, frame: 1782 });
    expect(result.skipped).toBe(0);
    expect(clock.wait).toHaveBeenCalledTimes(4);
    expect(deps.log.warn).not.toHaveBeenCalled();
  });

  it("takes a late shot late instead of dropping it", async () => {
    const clock = fakeClock();
    const registry = fakeRegistry(undefined, {
      onRun: () => {
        clock.time += 150;
      }
    });

    const result = await recordSeries(
      planSeries({ durationMs: 400, intervalMs: 100 }, CONFIG),
      registry,
      createDeps(clock)
    );

    // All 4 planned shots, the fourth at 450 ms although the series is 400 ms long.
    expect(result.shots.map(shot => shot.atMs)).toEqual([0, 150, 300, 450]);
    expect(clock.wait).not.toHaveBeenCalled();
  });

  it("takes the planned count even when a slow first shot ends past durationMs", async () => {
    const clock = fakeClock();
    let call = 0;
    const registry = fakeRegistry(undefined, {
      onRun: () => {
        call += 1;
        clock.time += call === 1 ? 1200 : 10;
      }
    });

    const result = await recordSeries(
      planSeries({ durationMs: 1000, intervalMs: 250 }, CONFIG),
      registry,
      createDeps(clock)
    );

    expect(result.shots.map(shot => shot.atMs)).toEqual([0, 1200, 1210, 1220]);
  });

  it("stops at the late ceiling when the shots are far slower than planned", async () => {
    const clock = fakeClock();
    const registry = fakeRegistry(undefined, {
      onRun: () => {
        clock.time += 2500;
      }
    });

    const result = await recordSeries(
      planSeries({ durationMs: 500, intervalMs: 100 }, CONFIG),
      registry,
      createDeps(clock)
    );

    // Ceiling: 500 + 3000 = 3500 ms.
    expect(result.shots.map(shot => shot.atMs)).toEqual([0, 2500]);
    expect(registry.capture).toHaveBeenCalledTimes(2);
  });

  it("lateCeilingMs is the length plus three seconds, inside the 5 s call slack", () => {
    expect(lateCeilingMs({ count: 4, durationMs: 1000, intervalMs: 250 })).toBe(4000);
    expect(lateCeilingMs({ count: 1250, durationMs: 20_000, intervalMs: 16 })).toBe(23_000);
  });

  it("skips a shot that throws or gives no picture and logs the count once", async () => {
    const deps = createDeps(fakeClock());
    const registry = fakeRegistry(call => {
      if (call === 1) return { error: new Error("boom") };
      if (call === 2) return { value: null };
      return { value: PNG };
    });

    const result = await recordSeries(
      planSeries({ durationMs: 400, intervalMs: 100 }, CONFIG),
      registry,
      deps
    );

    expect(result.shots.map(shot => shot.atMs)).toEqual([0, 300]);
    expect(result.skipped).toBe(2);
    expect(deps.log.warn).toHaveBeenCalledTimes(1);
    expect(deps.log.warn).toHaveBeenCalledWith("capture:shots-skipped", { skipped: 2 });
  });

  it("holds the run in state while recording and clears it afterwards", async () => {
    const deps = createDeps(fakeClock());
    const seen: (SeriesRun | undefined)[] = [];
    const registry = fakeRegistry(undefined, { onRun: () => seen.push(deps.state.series) });

    await recordSeries(planSeries({ durationMs: 200, intervalMs: 100 }, CONFIG), registry, deps);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ stopRequested: false });
    expect(deps.state.series).toBeUndefined();
  });

  it("ends the loop when a stop is requested", async () => {
    const deps = createDeps(fakeClock());
    const registry = fakeRegistry(undefined, {
      onRun: () => {
        if (registry.capture.mock.calls.length === 2) stopSeries(deps.state);
      }
    });

    const result = await recordSeries(
      planSeries({ durationMs: 1000, intervalMs: 100 }, CONFIG),
      registry,
      deps
    );

    expect(result.shots).toHaveLength(2);
    expect(deps.state.series).toBeUndefined();
  });

  it("does not shoot again when the stop came during the wait", async () => {
    const deps = createDeps({
      now: () => 0,
      wait: async (_ms, run) => {
        stopSeries(deps.state);
        expect(run.stopRequested).toBe(true);
      }
    });
    const registry = fakeRegistry();

    const result = await recordSeries(
      planSeries({ durationMs: 1000, intervalMs: 100 }, CONFIG),
      registry,
      deps
    );

    expect(result.shots).toHaveLength(1);
    expect(registry.capture).toHaveBeenCalledTimes(1);
  });

  it("answers no shots and no state when every shot fails", async () => {
    const deps = createDeps(fakeClock());
    const registry = fakeRegistry(() => ({ value: null }));

    const result = await recordSeries(
      planSeries({ durationMs: 300, intervalMs: 100 }, CONFIG),
      registry,
      deps
    );

    expect(result).toEqual({ shots: [], state: undefined, skipped: 3 });
  });

  it("clears the run even when the clock throws", async () => {
    const deps = createDeps({
      now: () => 0,
      wait: () => Promise.reject(new Error("clock broke"))
    });

    const error = await rejectionOf(
      recordSeries(planSeries({ durationMs: 300, intervalMs: 100 }, CONFIG), fakeRegistry(), deps)
    );

    expect(error).toMatchObject({ message: "clock broke" });
    expect(deps.state.series).toBeUndefined();
  });
});

describe("stopSeries", () => {
  it("answers false when no series runs", () => {
    const deps = createDeps(fakeClock());

    expect(stopSeries(deps.state)).toBe(false);
  });

  it("flags the run, clears its timer and wakes its wait", () => {
    vi.useFakeTimers();
    const wake = vi.fn();
    const timer = setTimeout(() => undefined, 1000);
    const deps = createDeps(fakeClock());
    deps.state.series = { stopRequested: false, timer, wake };

    expect(stopSeries(deps.state)).toBe(true);
    expect(deps.state.series).toMatchObject({ stopRequested: true, timer: undefined });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("browserClock", () => {
  it("reads performance.now", () => {
    vi.useFakeTimers({ now: 0 });
    const before = browserClock.now();
    vi.advanceTimersByTime(250);

    expect(browserClock.now() - before).toBe(250);
  });

  it("waits with a setTimeout stored on the run", async () => {
    vi.useFakeTimers();
    const run: SeriesRun = { stopRequested: false, timer: undefined, wake: undefined };
    const done = vi.fn();

    const waiting = browserClock.wait(100, run).then(done);
    expect(run.timer).toBeDefined();
    expect(run.wake).toBeDefined();

    await vi.advanceTimersByTimeAsync(99);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;

    expect(done).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ timer: undefined, wake: undefined });
  });

  it("ends the wait at once on a stop", async () => {
    vi.useFakeTimers();
    const run: SeriesRun = { stopRequested: false, timer: undefined, wake: undefined };
    const waiting = browserClock.wait(10_000, run);

    stopSeries({ series: run });
    await waiting;

    expect(vi.getTimerCount()).toBe(0);
    expect(run.wake).toBeUndefined();
  });

  it("does not wait when the run is already stopped", async () => {
    vi.useFakeTimers();
    const run: SeriesRun = { stopRequested: true, timer: undefined, wake: undefined };

    await browserClock.wait(10_000, run);

    expect(vi.getTimerCount()).toBe(0);
  });
});
