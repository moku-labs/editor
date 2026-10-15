// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is "not known" in the engine's rate (displayHz without adaptive) */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAUSE_BITS, causesOf, createPerfWindow, readWireWindow } from "../../protocol";
import { stallOnce, startPair } from "../real-engine";

// ─────────────────────────────────────────────────────────────────────────────
// perf against the REAL engine (spec 03 § Against the shipped engine, item 3):
// a real createApp game with the agent flag on, its renderer on a stand-in Pixi
// (the engine ships no mock renderer; harness in ../real-engine.ts), frames from a scripted rAF. perf reads
// the engine's ring: the window fills, a 25.1 ms gap is a gap spike, every row's
// budget is the ring's, slot = k % capacity, and the bit order is the engine's.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("perf on the real engine", () => {
  it("reads the engine's ring: the window fills, 40 ms of work is a js spike, a 25.1 ms pause is none, each row's budget is the ring's", async () => {
    const { game, editor, step } = await startPair();
    const stall = stallOnce(game);
    for (let index = 0; index < 20; index += 1) step(16.7);
    step(25.1);
    for (let index = 0; index < 20; index += 1) step(16.7);
    stall.arm(40);
    for (let index = 0; index < 60; index += 1) step(16.7);
    vi.advanceTimersByTime(250);

    const ring = game.renderer.monitor.frames();
    // The stand-in renderer is WebGL without a GPU timer: the header's gpu.timer is null.
    expect(editor.perf.status()).toEqual({ state: "on", lost: 0, gpuTimer: false });
    const [spike] = editor.perf.spikes();
    expect(editor.perf.spikes()).toHaveLength(1);
    expect(spike).toMatchObject({ cause: "js", causes: ["js"] });

    editor.perf.readWindow(window => {
      expect(window.count).toBe(ring.written);
      for (let row = 0; row < window.count; row += 1) {
        const slot = row % ring.capacity;
        expect(ring.columns.frame[slot]).toBe(window.frame[row]);
        expect(window.budgetMs[row]).toBe(ring.columns.budgetMs[slot]);
      }
    });
    const spikeSlot =
      (ring.written - 1 - (ring.columns.frame[ring.newest] ?? 0) + (spike?.frame ?? 0)) %
      ring.capacity;
    expect(ring.columns.causes[spikeSlot]).toBe(1 << CAUSE_BITS.indexOf("js"));
    expect(editor.perf.second().budgetMs).toBe(16.67);
    // The engine's own stats(): kept and renderPassesMax (spec 23) in every build, redraws and
    // rebuilds (spec 26) on this agent build.
    expect(editor.perf.second().render).toEqual({
      passesMax: expect.any(Number),
      kept: { pictures: 0, mb: 0, retakes: 0 },
      redraws: 0,
      rebuilds: 0
    });
    expect(editor.perf.second().sample).toHaveProperty("kept");

    const detail = editor.perf.spike(spike?.frame ?? 0)?.detail;
    expect(detail?.frame.causes).toEqual(causesOf(ring.columns.causes[spikeSlot] ?? 0));
    expect(detail?.frame.budgetMs).toBe(16.67);

    await editor.stop();
    await game.stop();
  });

  it("reads the rate from the header, then a game.frameRate switch from its rate line: second().rate, the row budgets and the record's rateSwitch (spec 21)", async () => {
    const { game, editor, step } = await startPair();
    const stall = stallOnce(game);
    for (let index = 0; index < 20; index += 1) step(16.7);
    vi.advanceTimersByTime(250);
    expect(editor.perf.second().rate).toEqual({
      fps: 60,
      mode: "fixed",
      reason: "start",
      displayHz: null,
      switches: 0
    });

    const ran = await editor.registry.command("game.frameRate")?.run({ fps: 30 });
    expect(ran?.value).toMatchObject({ fps: 30, mode: "forced", reason: "forced" });
    stall.arm(40); // the first 30 fps frame works 40 ms: a js spike over its 33.3 ms budget
    step(60);
    for (let index = 0; index < 10; index += 1) step(33.4);
    vi.advanceTimersByTime(250);

    const second = editor.perf.second();
    expect(second.rate).toEqual({
      fps: 30,
      mode: "forced",
      reason: "forced",
      displayHz: null,
      switches: 1
    });
    expect(second.budgetMs).toBe(33.33);
    const [spike] = editor.perf.spikes();
    expect(spike).toMatchObject({ cause: "js", budgetMs: 33.33 });
    expect(editor.perf.spike(spike?.frame ?? 0)?.rateSwitch).toEqual({
      from: 60,
      to: 30,
      reason: "forced",
      mode: "forced"
    });

    await editor.stop();
    await game.stop();
  });
});

describe("perf on the real engine without the agent flag (a page moku-game dev did not write)", () => {
  it("waits, and the tools page reads its window source as an empty window (bug: the strip warned 'unexpected source shape' for editor.perf.window on every Render show)", async () => {
    const { game, editor, step } = await startPair({ agent: false });
    for (let index = 0; index < 30; index += 1) step(16.7);
    vi.advanceTimersByTime(250);
    expect(editor.perf.status()).toEqual({ state: "waiting" });

    const wire = editor.registry.source("editor.perf.window")?.read(null) ?? null;
    const into = createPerfWindow(1024);
    expect(readWireWindow(wire, into)).toBe(true);
    expect([into.count, into.spikeCount, into.version]).toEqual([0, 0, 1]);

    await editor.stop();
    await game.stop();
  });
});
