import { describe, expect, it } from "vitest";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { createPerfApi } from "../../api";
import type { PerfWindowView } from "../../protocol";
import { readTick } from "../../reader";
import { attach, commitFrames, perfCtx, perfState } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// api: the window visitor, the frozen second(), status, spikes and the monitor.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The perf API over a state with a fake monitor and three frames read.
 *
 * @returns The api, the state and the monitor.
 */
function setup() {
  const perf = perfState();
  const monitor = createFakeMonitor();
  attach(perf.state, monitor);
  commitFrames(monitor, 3, 0, 16.7);
  readTick(perf.state, perf.config);
  const { ctx } = perfCtx(perf);
  return { api: createPerfApi(ctx), state: perf.state, monitor };
}

/**
 * A renderer.stats() answer for the tests.
 *
 * @returns The answer.
 */
function keptStats() {
  return {
    renderPasses: 1,
    renderPassesMax: 1,
    kept: { pictures: 1, mb: 1.4, retakes: 0 }
  };
}

describe("readWindow", () => {
  it("calls its visitor once, synchronously, with the same live window every time (bug: a copy per 4 Hz paint)", () => {
    const { api, state } = setup();
    const seen: PerfWindowView[] = [];
    api.readWindow(window => seen.push(window));
    expect(seen).toHaveLength(1);
    api.readWindow(window => seen.push(window));
    expect(seen[0]).toBe(state.window);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0]?.count).toBe(3);
  });

  it("hands a window of count 0 while off or waiting", () => {
    const off = perfState();
    off.state.off = "no-renderer";
    const counts: number[] = [];
    createPerfApi(perfCtx(off).ctx).readWindow(window => counts.push(window.count));
    expect(counts).toEqual([0]);
  });

  it("lets a throwing visitor reach the caller and leaves the window unchanged (bug: a paint error that corrupts the model)", () => {
    const { api } = setup();
    let before = -1;
    api.readWindow(window => {
      before = window.version;
    });
    expect(() =>
      api.readWindow(() => {
        throw new Error("paint failed");
      })
    ).toThrow("paint failed");
    api.readWindow(window => {
      expect([window.version, window.count]).toEqual([before, 3]);
    });
  });

  it("has no member that returns the window (bug: state leaking out of the plugin)", () => {
    const { api, state } = setup();
    const answers = [api.status(), api.second(), api.spikes(), api.spike(1), api.monitor()];
    expect(answers).not.toContain(state.window);
    expect(Object.keys(api).toSorted()).toEqual([
      "monitor",
      "readWindow",
      "second",
      "spike",
      "spikes",
      "status"
    ]);
  });
});

describe("second()", () => {
  it("is frozen with its fps, rate, render and kept; a write fails and the next second() is the same (bug: the overlay's formatter writing into perf's cached value)", () => {
    const perf = perfState();
    const monitor = createFakeMonitor();
    const stats = keptStats;
    attach(perf.state, monitor, stats);
    commitFrames(monitor, 3, 0, 16.7);
    readTick(perf.state, perf.config);
    const api = createPerfApi(perfCtx(perf).ctx);
    const second = api.second();
    expect(Object.isFrozen(second)).toBe(true);
    expect(
      [second.fps, second.rate, second.render, second.render?.kept].every(value =>
        Object.isFrozen(value)
      )
    ).toBe(true);
    expect(Reflect.set(second, "spikes", 9)).toBe(false);
    expect(Reflect.set(second.fps, "loop", 0)).toBe(false);
    expect(api.second()).toBe(second);
    expect(second.fps.loop).toBe(3);
    expect(second.spikes).toBe(0);
  });
});

describe("status, spikes and monitor", () => {
  it("answers on with lost frames and the GPU timer, off with the reason", () => {
    const { api, monitor } = setup();
    expect(api.status()).toEqual({ state: "on", lost: 0, gpuTimer: true });
    expect(api.monitor()).toBe(monitor);
    const off = perfState();
    off.state.off = "no-monitor";
    const offApi = createPerfApi(perfCtx(off).ctx);
    expect(offApi.status()).toEqual({ state: "off", reason: "no-monitor" });
    expect([offApi.spikes(), offApi.monitor()]).toEqual([[], undefined]);
  });
});
