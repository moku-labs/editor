// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { stallOnce, startPair } from "../real-engine";

// ─────────────────────────────────────────────────────────────────────────────
// spec 03 delta 2026-10-15 on the REAL engine: an idle game is idle, not a
// spike storm. The engine rests on a still screen (frames at its idle cap after
// idleAfterMs, render on demand draws nothing); a browser may also throttle the
// page's frames to 1–2 Hz. None of that is a spike; real work still is.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Runs frames `tickMs` apart for `ms` of page clock.
 *
 * @param step - The pair's frame stepper.
 * @param ms - How long.
 * @param tickMs - The rAF interval.
 */
function runFor(step: (gapMs: number) => void, ms: number, tickMs: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) step(tickMs);
}

describe("perf on an idle real engine", () => {
  it("a still screen past idleAfterMs makes no spike and says idle, since when, with loop fps 0", async () => {
    const { game, editor, step } = await startPair({ onDemand: true });
    runFor(step, 1000, 16.7);
    runFor(step, 4000, 16.7);
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes()).toEqual([]);
    const second = editor.perf.second();
    expect(second.activity).toMatchObject({ idle: true, idleSince: expect.any(Number) });
    expect(second.activity?.idleFrames).toBeGreaterThan(0);
    expect(second.fps.loop).toBe(0);
    await editor.stop();
    await game.stop();
  });

  it("the wake after a rest makes no gap spike (the engine flags it)", async () => {
    const { game, editor, step } = await startPair({ onDemand: true });
    runFor(step, 4000, 16.7);
    game.time.wake();
    runFor(step, 200, 16.7);
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes()).toEqual([]);
    await editor.stop();
    await game.stop();
  });

  it("a page the browser throttles to 2 Hz on a still on-demand screen makes no spike (the owner's case)", async () => {
    const { game, editor, step } = await startPair({ onDemand: true });
    runFor(step, 500, 16.7);
    runFor(step, 4000, 500);
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes()).toEqual([]);
    expect(editor.perf.second().activity?.idle).toBe(true);
    await editor.stop();
    await game.stop();
  });

  it("40 ms of work while awake is still a spike; a 40 ms pause without work is not", async () => {
    const { game, editor, step } = await startPair();
    const stall = stallOnce(game);
    runFor(step, 300, 16.7);
    step(40);
    runFor(step, 300, 16.7);
    stall.arm(40);
    runFor(step, 300, 16.7);
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes().map(spike => spike.cause)).toEqual(["js"]);
    await editor.stop();
    await game.stop();
  });

  it("a 1001 ms pause without work while awake is a break, not a spike, and leaves the fps and p90 to the measured frames (the browser made no frame)", async () => {
    const { game, editor, step } = await startPair();
    runFor(step, 600, 16.7);
    step(1001);
    runFor(step, 300, 16.7);
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes()).toEqual([]);
    const second = editor.perf.second();
    expect(second.activity).toMatchObject({ idle: false, breaks: 1 });
    expect(second.activity?.p90Ms).toBeLessThan(20);
    expect(second.fps.loop).toBeGreaterThanOrEqual(17);
    await editor.stop();
    await game.stop();
  });

  it("A Memory Missing's config (120 fps target, adaptive, no idle cap, on demand) on a 60 Hz display with vsync jitter: no spike at rest, none in an awake pan of 3 ms frames, one for a 40 ms stall", async () => {
    const { game, editor, step } = await startPair({
      maxFps: 120,
      idleFps: 0,
      adaptive: true,
      onDemand: true
    });
    const jitter = [16.7, 17.6, 17.7, 16.7, 15.8, 16.7];
    let tick = 0;
    const runJittered = (ms: number, each?: () => void): void => {
      const until = performance.now() + ms;
      while (performance.now() < until) {
        each?.();
        step(jitter[tick % jitter.length] ?? 16.7);
        tick += 1;
      }
    };
    // At rest: the loop ticks, nothing is drawn; a throttled stretch on top (the tools page's long frame).
    runJittered(3000);
    step(1001);
    runJittered(1000);
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes()).toEqual([]);

    // Awake: every frame drawn (a pan) with 3 ms of work each.
    const work = stallOnce(game);
    runJittered(3000, () => {
      game.time.wake();
      work.arm(3);
    });
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes()).toEqual([]);

    // A real stall while awake.
    game.time.wake();
    work.arm(40);
    step(16.7);
    runJittered(500, () => game.time.wake());
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes().map(spike => spike.cause)).toEqual(["js"]);
    await editor.stop();
    await game.stop();
  });

  it("keeps the display the engine announces with its learned hz (game@0fda201: a display event when the panel's rate is learned)", async () => {
    const { game, editor, step } = await startPair({ adaptive: true, maxFps: 120 });
    runFor(step, 3000, 16.7);
    vi.advanceTimersByTime(250);
    const learned = game.time.rate().displayHz;
    expect(learned).toBe(60);
    expect(editor.perf.second().display?.hz).toBe(learned);
    expect(editor.perf.second().rate.displayHz).toBe(learned);
    await editor.stop();
    await game.stop();
  });

  it("shows the engine's display rate (its rate's displayHz), never the loop's ticks", async () => {
    const { game, editor, step } = await startPair({ adaptive: true, maxFps: 120 });
    runFor(step, 3000, 8.33);
    vi.advanceTimersByTime(250);
    expect(editor.perf.second().rate.displayHz).toBe(game.time.rate().displayHz);
    await editor.stop();
    await game.stop();
  });
});
