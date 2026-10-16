// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is "not known" in the engine's rate (displayHz without adaptive) */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import type { PerfEventsWire } from "../../protocol";
import {
  CAUSE_BITS,
  causesOf,
  createPerfWindow,
  eventsOf,
  readFramesWire,
  readWireWindow
} from "../../protocol";
import {
  CANVAS_DRAWS,
  CANVAS_TARGET,
  FILTER_DRAWS,
  FILTER_TARGET,
  PIPELINE_LABEL
} from "../counted-gpu";
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

/**
 * The newest two cells of a pass rows column: the newest frame's canvas and filter pass.
 *
 * @param column - The column.
 * @returns Its last two cells.
 */
function lastTwo<Value>(column: readonly Value[] | undefined): Value[] | undefined {
  return column?.slice(-2);
}

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

describe("Mission control's feeds on an uncounted WebGL page of the dev engine (0.15.1, spec 03 Delta 2026-10-16 D15)", () => {
  it("answer every new id with the blocks it does not measure absent and those capabilities false; nothing throws (bug: WebGL's drawsAt 0 shown as passes of 0 draws)", async () => {
    const { editor, step } = await startPair();
    const read = (id: string, input: Json = {}): Json =>
      editor.registry.source(id)?.read(input) ?? null;
    await editor.registry.command("editor.perf.sections")?.run({ passes: true, nodes: true });
    for (let index = 0; index < 90; index += 1) step(16.7);
    vi.advanceTimersByTime(250);

    const frames = readFramesWire(read("editor.perf.frames"));
    expect(frames?.frame.length).toBeGreaterThan(60);
    expect(frames?.gpuTimer).toBe(false);
    expect(frames?.gpuMs.every(ms => ms === null)).toBe(true);
    expect(read("editor.perf.events")).toMatchObject({ v: 1, lost: false });
    const newest = frames?.frame.at(-1) ?? 0;
    expect(read("editor.perf.detail", { from: newest - 5, to: newest })).toMatchObject({
      source: "agent",
      reason: "no-detail"
    });
    expect(() => read("editor.perf.passes")).not.toThrow();
    // 0.15.1 writes the pass ring's owner column on every backend, draws only where it counts them.
    expect(editor.perf.second()).toMatchObject({
      caps: {
        passOwners: true,
        passDraws: false,
        sections: false,
        detail: false,
        gpuTimer: false
      },
      monitor: { engine: false, feeds: { passes: true, systems: true, nodes: true } },
      memory: { trusted: false }
    });
  });
});

describe("Mission control's feeds on a counted WebGPU page of the dev engine (0.15.1, delta-data Verification)", () => {
  it("show the pass owners, filters and draws, a shader event, a problem, the system names, the sample's counts and targets and the build's app id (bug: a 0.15.1 column or line perf reads under another name)", async () => {
    const appId = "com.mokulabs.timber.debug";
    const { game, editor, step, filterOwner } = await startPair({
      backend: "webgpu",
      filterKind: "fog.blur",
      appId,
      idleAfterMs: 60_000
    });
    const read = (id: string, input: Json = {}): Json =>
      editor.registry.source(id)?.read(input) ?? null;
    await editor.registry.command("editor.perf.sections")?.run({ passes: true });
    // Over three seconds: the stand-in makes and drops a render target every frame (target-churn).
    for (let index = 0; index < 200; index += 1) step(16.7);
    vi.advanceTimersByTime(250);

    // The newest frame's two passes: the canvas (3 draws), then the entity's filter (1 draw), its
    // kind named from the frame ring's kindNames by the pass's kind2.
    const ring = game.renderer.monitor.frames();
    const frames = readFramesWire(read("editor.perf.frames"));
    const passes = frames?.passes;
    expect({
      kind: lastTwo(passes?.kind),
      owner: lastTwo(passes?.owner),
      filter: lastTwo(passes?.filter),
      draws: lastTwo(passes?.draws),
      format: lastTwo(passes?.format),
      resolution: lastTwo(passes?.resolution)
    }).toEqual({
      kind: ["canvas", "filter"],
      owner: [null, filterOwner],
      filter: [null, "fog.blur"],
      draws: [CANVAS_DRAWS, FILTER_DRAWS],
      format: [CANVAS_TARGET.colorTexture.source.format, FILTER_TARGET.colorTexture.source.format],
      resolution: [
        CANVAS_TARGET.colorTexture.source.resolution,
        FILTER_TARGET.colorTexture.source.resolution
      ]
    });
    expect(ring.kindNames).toEqual(["other", "fog.blur"]);
    expect(frames?.systems?.names).toEqual([...ring.systemNames]);
    expect(ring.systemNames.length).toBeGreaterThan(0);

    // The compile of the filter's first apply, at boot, and the churn of its targets.
    const events = eventsOf(read("editor.perf.events") as PerfEventsWire);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "shader",
        what: "compile",
        label: PIPELINE_LABEL,
        boot: true,
        pass: 1,
        filter: "fog.blur",
        owner: filterOwner
      })
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "problem",
        rule: "target-churn",
        reason: "rate",
        cleared: false
      })
    );

    const second = editor.perf.second();
    expect(second.caps).toMatchObject({
      passOwners: true,
      passDraws: true,
      passFormat: true,
      systemNames: true,
      shaderEvents: true,
      problems: true
    });
    expect(second.counts).toEqual(second.sample?.counts);
    expect(second.counts).toMatchObject({ entities: 1, clockListeners: expect.any(Number) });
    expect(second.sample?.targets).toEqual({ created: 60, destroyed: 60 });
    // The header's app.id and the registry's BuildInfo.appId: the same __MOKU_GAME_APP__.
    expect(second.appId).toBe(appId);
    expect(editor.registry.build().appId).toBe(appId);

    await editor.stop();
    await game.stop();
  });
});
