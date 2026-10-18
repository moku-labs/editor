/* eslint-disable unicorn/no-null -- null is "not known" in perf's activity values */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import { perfPlugin } from "../..";
import { initPerf, startPerf, stopPerf } from "../../lifecycle";
import { secondOf } from "../../records";
import type { PerfConfig } from "../../types";
import { commitFrames, perfCtx, perfState, startedGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// lifecycle: the config checks at createApp, onInit, onStart and onStop.
// ─────────────────────────────────────────────────────────────────────────────

const { createApp } = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, perfPlugin] });

afterEach(() => {
  vi.useRealTimers();
});

describe("the config checks", () => {
  it.each<[Partial<PerfConfig>, string]>([
    [
      { readEveryMs: 20 },
      "[moku-editor] perf.readEveryMs is 20.\n  Give milliseconds from 50 to 1000; 250 reads four times a second."
    ],
    [
      { windowMs: Number.NaN },
      "[moku-editor] perf.windowMs is NaN.\n  Give milliseconds from 1000 to 30000; the graph shows 6000."
    ],
    [
      { frames: 100.5 },
      "[moku-editor] perf.frames is 100.5.\n  Give a whole number from 64 to 16384, at least the frames of windowMs at 120 Hz."
    ],
    [
      { frames: 20_000 },
      "[moku-editor] perf.frames is 20000.\n  Give a whole number from 64 to 16384, at least the frames of windowMs at 120 Hz."
    ]
  ])("throws a TypeError at createApp for %o", async (perf, message) => {
    const game = await startedGame();
    const create = () => createApp({ pluginConfigs: { registry: { game: game.app }, perf } });
    expect(create).toThrow(TypeError);
    expect(create).toThrow(message);
    await game.stop();
  });
});

describe("onInit and onStart", () => {
  it("without a monitor logs perf:off once and starts no timer and no listener", () => {
    vi.useFakeTimers();
    const perf = perfState();
    const added: string[] = [];
    const registry = {
      game: () => ({ time: {}, flow: {} }),
      add: (entry: { descriptor: { id: string } }) => added.push(entry.descriptor.id)
    };
    const { ctx, log } = perfCtx(perf, registry);
    initPerf(ctx);
    startPerf(ctx);
    expect(perf.state.off).toBe("no-renderer");
    expect(added).toHaveLength(10);
    expect(log.info).toHaveBeenCalledExactlyOnceWith("perf:off", { reason: "no-renderer" });
    expect([perf.state.timer, perf.state.unsubscribe]).toEqual([undefined, undefined]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("with a monitor subscribes, reads at once and every readEveryMs", () => {
    vi.useFakeTimers();
    const perf = perfState();
    const monitor = createFakeMonitor();
    const registry = { game: () => ({ renderer: { monitor } }), add: () => undefined };
    const { ctx, log } = perfCtx(perf, registry);
    initPerf(ctx);
    startPerf(ctx);
    expect([monitor.listeners, monitor.reads]).toEqual([1, 1]);
    expect(perf.state.header?.kind).toBe("header");
    vi.advanceTimersByTime(250);
    expect(monitor.reads).toBe(2);
    expect(log.info).not.toHaveBeenCalled();
    stopPerf(ctx);
  });
});

describe("onStop", () => {
  it("clears the timer and unsubscribes, so a second start does not read twice per tick", () => {
    vi.useFakeTimers();
    const perf = perfState();
    const monitor = createFakeMonitor();
    const registry = { game: () => ({ renderer: { monitor } }), add: () => undefined };
    const { ctx } = perfCtx(perf, registry);
    initPerf(ctx);
    startPerf(ctx);
    stopPerf(ctx);
    expect([monitor.listeners, vi.getTimerCount(), perf.state.watchers.size]).toEqual([0, 0, 0]);
    vi.advanceTimersByTime(1000);
    expect(monitor.reads).toBe(1);

    startPerf(ctx);
    vi.advanceTimersByTime(250);
    expect(monitor.reads).toBe(3);
    expect(monitor.listeners).toBe(1);
    stopPerf(ctx);
  });
});

describe("a failing start and a stop", () => {
  it("undoes the stream subscription and starts no timer when the first tick throws (bug: a listener left behind by a failed start)", () => {
    vi.useFakeTimers();
    const perf = perfState();
    const monitor = createFakeMonitor();
    monitor.failRead = new Error("ring torn");
    const registry = { game: () => ({ renderer: { monitor } }), add: () => undefined };
    const { ctx } = perfCtx(perf, registry);
    initPerf(ctx);
    expect(() => startPerf(ctx)).toThrow("ring torn");
    expect([monitor.listeners, perf.state.unsubscribe, vi.getTimerCount()]).toEqual([
      0,
      undefined,
      0
    ]);
  });

  it("answers fps 0 after a stop (bug: the pill showing the last second of a stopped game)", () => {
    vi.useFakeTimers();
    const perf = perfState();
    const monitor = createFakeMonitor();
    commitFrames(monitor, 30, 0, 16.7);
    const registry = { game: () => ({ renderer: { monitor } }), add: () => undefined };
    const { ctx } = perfCtx(perf, registry);
    initPerf(ctx);
    startPerf(ctx);
    expect(secondOf(perf.state).fps.loop).toBe(30);
    stopPerf(ctx);
    expect(secondOf(perf.state).fps).toEqual({ loop: 0, drawn: 0 });
  });

  it("forgets the rest and the last awake p90 at a stop: the next run shows its own (bug: a new run idle since the last run's rest)", () => {
    vi.useFakeTimers();
    const perf = perfState();
    const monitor = createFakeMonitor({ capacity: 256 });
    for (let index = 0; index < 10; index += 1) {
      monitor.commit({ t: index * 16.7, gapMs: 16.7, workMs: index >= 8 ? 30 : 3 });
    }
    commitFrames(monitor, 5, 200, 33.4, { idle: true, capMs: 33.33 });
    const registry = { game: () => ({ renderer: { monitor } }), add: () => undefined };
    const { ctx } = perfCtx(perf, registry);
    initPerf(ctx);
    startPerf(ctx);
    expect(secondOf(perf.state).activity).toMatchObject({ idle: true, p90Ms: 30 });
    stopPerf(ctx);
    expect(secondOf(perf.state).activity).toMatchObject({ idleSince: null, p90Ms: null });

    monitor.restart();
    commitFrames(monitor, 5, 5000, 33.4, { idle: true, capMs: 33.33 });
    startPerf(ctx);
    const origin = perf.state.header?.timeOrigin ?? 0;
    expect(secondOf(perf.state).activity).toMatchObject({
      idle: true,
      idleSince: origin + 5000,
      p90Ms: null
    });
    stopPerf(ctx);
  });
});
