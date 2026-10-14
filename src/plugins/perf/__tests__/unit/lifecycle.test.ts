import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import { perfPlugin } from "../..";
import { initPerf, startPerf, stopPerf } from "../../lifecycle";
import type { PerfConfig } from "../../types";
import { perfCtx, perfState, startedGame } from "../helpers";

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
    expect(added).toHaveLength(5);
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
