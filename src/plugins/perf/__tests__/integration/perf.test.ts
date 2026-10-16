/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's lines and perf's values */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import {
  createFakeMonitor,
  ENGINE_0_15_0,
  shaderLine
} from "../../../../../tests/fixtures/fake-monitor";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import type { Json } from "../../../registry/protocol";
import type { GameLike } from "../../../registry/types";
import { perfPlugin } from "../..";
import type { PerfEventsWire, PerfPassesWire } from "../../protocol";
import {
  createPerfWindow,
  eventsOf,
  passesSummaryOf,
  readFramesWire,
  readWireWindow
} from "../../protocol";
import { commitFrames, startedGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// perf in a real agent app (registry + perf) on a started headless engine game,
// with the fake monitor grafted on as its renderer; then the same app on a game
// without a renderer.
// ─────────────────────────────────────────────────────────────────────────────

const { createApp } = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, perfPlugin] });

/** The ids of perf's sources. */
const PERF_IDS = [
  "editor.perf.second",
  "editor.perf.window",
  "editor.perf.spikes",
  "editor.perf.spike",
  "editor.spikes"
];

/** What each test stops. */
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0).toReversed()) await stop();
  vi.useRealTimers();
});

/**
 * Starts a headless game, grafts a renderer with the fake monitor (when given) and starts the
 * agent app with registry and perf on it.
 *
 * @param monitor - The fake monitor; none for a game without a renderer.
 * @returns The agent app.
 */
async function startEditor(monitor?: FakeMonitor) {
  const game = await startedGame();
  stops.push(() => game.stop());
  const grafted: GameLike =
    monitor === undefined
      ? game.app
      : Object.create(game.app, { renderer: { value: { monitor } } });
  vi.useFakeTimers();
  const editor = createApp({ pluginConfigs: { registry: { game: grafted } } });
  editor.log.clearSinks();
  await editor.start();
  stops.push(() => editor.stop());
  return editor;
}

describe("perf on a game with a monitor", () => {
  it("subscribes and reads at start, fills the window, finds a spike, serves the sources and stops", async () => {
    const monitor = createFakeMonitor({ capacity: 512 });
    const editor = await startEditor(monitor);
    expect([monitor.listeners, monitor.reads]).toEqual([1, 1]);
    expect(editor.perf.status()).toEqual({ state: "on", lost: 0, gpuTimer: true });

    commitFrames(monitor, 30, 1000, 16.7);
    const spike = monitor.commit({ t: 1501, gapMs: 25.1, workMs: 30, causes: 0b11 });
    commitFrames(monitor, 30, 1526.1, 16.7);
    vi.advanceTimersByTime(250);

    let count = 0;
    editor.perf.readWindow(window => {
      count = window.count;
    });
    expect(count).toBe(61);
    expect(editor.perf.spikes()).toMatchObject([{ frame: spike, cause: "js", ms: 30 }]);

    const manifest = editor.registry.manifest();
    const listed = manifest.sources.filter(source => PERF_IDS.includes(source.id));
    expect(listed.map(source => [source.id, source.available])).toEqual(
      PERF_IDS.map(id => [id, undefined])
    );
    expect(editor.registry.source("editor.perf.spikes")?.read(null)).toMatchObject([
      { frame: spike }
    ]);
    const window = createPerfWindow(1024);
    const wire: Json = editor.registry.source("editor.perf.window")?.read(null) ?? null;
    expect(readWireWindow(wire, window)).toBe(true);
    expect([window.count, window.spikeCount, window.frame[window.spikes[0] ?? 0]]).toEqual([
      61,
      1,
      spike
    ]);

    await editor.stop();
    stops.pop();
    const reads = monitor.reads;
    commitFrames(monitor, 5, 2100, 16.7);
    vi.advanceTimersByTime(1000);
    expect([monitor.reads, monitor.listeners]).toEqual([reads, 0]);
  });
});

describe("perf and a noisy GPU (spec 03 delta item 8)", () => {
  it("never lists a lone GPU outlier as a spike, shows it as noise on the wire, flags a sustained GPU when its second result lands, and heads with the window's GPU p50/p90", async () => {
    const monitor = createFakeMonitor({ capacity: 512 });
    const editor = await startEditor(monitor);
    commitFrames(monitor, 20, 1000, 16.7, { gpuMs: 0.49 });
    const outlier = monitor.commit({ t: 1334, gapMs: 16.7, gpuMs: 21, causes: 0b100 });
    commitFrames(monitor, 5, 1350.7, 16.7, { gpuMs: 0.49 });
    const late = commitFrames(monitor, 3, 1434.2, 16.7, { gpuPartial: true });
    vi.advanceTimersByTime(250);

    expect(editor.perf.second().spikes).toBe(0);
    const into = createPerfWindow(512);
    const wire: Json = editor.registry.source("editor.perf.window")?.read(null) ?? null;
    expect(readWireWindow(wire, into)).toBe(true);
    const row = [...into.frame.subarray(0, into.count)].indexOf(outlier);
    expect([into.noise[row], into.cause[row]]).toEqual([0b100, 0]);

    monitor.landGpu(late[0] ?? 0, 19, 0b100);
    monitor.landGpu(late[1] ?? 0, 20, 0b100);
    vi.advanceTimersByTime(250);
    expect(editor.perf.spikes().map(spike => [spike.frame, spike.cause])).toEqual([
      [late[0], "gpu"],
      [late[1], "gpu"]
    ]);
    expect(editor.perf.second().gpuTime).toEqual({ p50Ms: 0.49, p90Ms: 19 });
  });
});

describe("perf on a game without a renderer", () => {
  it("is off, lists its five sources not available with the reason, and their reads answer -32008", async () => {
    const editor = await startEditor();
    expect(editor.perf.status()).toEqual({ state: "off", reason: "no-renderer" });
    expect(editor.perf.spikes()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    const listed = editor.registry
      .manifest()
      .sources.filter(source => PERF_IDS.includes(source.id));
    expect(listed).toHaveLength(5);
    for (const source of listed) {
      expect(source).toMatchObject({
        available: false,
        reason: "the game has no renderer (headless)"
      });
    }
    expect(() => editor.registry.source("editor.perf.second")?.read(null)).toThrow(
      expect.objectContaining({ code: -32_008 })
    );
  });
});

/**
 * Commits 70 frames from page-clock 1000, each with a canvas pass and two `fog.blur` passes of
 * owner 412, and a `shader` compile line.
 *
 * @param monitor - The fake monitor.
 */
function commitMission(monitor: FakeMonitor): void {
  for (let index = 0; index < 70; index += 1) {
    monitor.commit({ t: 1000 + index * 16.7, gapMs: 16.7, draws: 42 });
    monitor.commitPass({ label: "main", gpuMs: 2, drawsAt: 0 });
    for (const drawsAt of [40, 41]) {
      monitor.commitPass({ kind: "filter", owner: 412, filter: "fog.blur", gpuMs: 3, drawsAt });
    }
  }
  monitor.emit(shaderLine());
  vi.advanceTimersByTime(250);
}

describe("Mission control's feeds in an agent app (spec 03 Delta 2026-10-16)", () => {
  it("on a 0.15.x engine: each frame once with its passes, the compile on the events, a chain on the passes, and sections { passes: false } drops the passes block", async () => {
    const monitor = createFakeMonitor({ capacity: 512 });
    const editor = await startEditor(monitor);
    const read = (id: string, input: Json = {}): Json =>
      editor.registry.source(id)?.read(input) ?? null;
    const sections = editor.registry.command("editor.perf.sections");
    await sections?.run({ passes: true });
    commitMission(monitor);

    const frames = readFramesWire(read("editor.perf.frames"));
    expect(frames?.frame).toHaveLength(70);
    expect(frames?.passes?.row).toHaveLength(210);
    expect(frames?.passes?.owner.slice(0, 3)).toEqual([null, 412, 412]);
    const newest = frames?.frame.at(-1) ?? 0;
    expect(readFramesWire(read("editor.perf.frames", { after: newest }))?.frame).toEqual([]);

    // The agent sends raw lines and rows; the tools page builds the marks and the chains.
    const events = eventsOf(read("editor.perf.events") as PerfEventsWire);
    // The switch of the engine's passes section is a timeline mark too, then the compile.
    expect(events).toMatchObject([
      { kind: "sections", on: ["passes"] },
      { kind: "shader", what: "compile", label: "fog.blur" }
    ]);
    expect(passesSummaryOf(read("editor.perf.passes") as PerfPassesWire)).toMatchObject({
      source: "agent",
      chains: [{ owner: 412, kinds: ["fog.blur", "fog.blur"] }]
    });
    expect(editor.perf.second().caps).toMatchObject({ passOwners: true, shaderEvents: true });

    await sections?.run({ passes: false });
    monitor.commit({ t: 2200, gapMs: 16.7 });
    vi.advanceTimersByTime(250);
    expect(readFramesWire(read("editor.perf.frames", { after: newest }))?.passes).toBeUndefined();
  });

  it("on the peer floor's shape (0.15.0): the same ids answer with the blocks absent and the capabilities false, nothing throws", async () => {
    const monitor = createFakeMonitor({ capacity: 512, ...ENGINE_0_15_0 });
    const editor = await startEditor(monitor);
    const read = (id: string, input: Json = {}): Json =>
      editor.registry.source(id)?.read(input) ?? null;
    const answer = await editor.registry.command("editor.perf.sections")?.run({ passes: true });
    expect(answer?.value).toMatchObject({ engine: false, feeds: { passes: true } });
    commitMission(monitor);

    const frames = readFramesWire(read("editor.perf.frames"));
    expect(frames?.passes?.owner.slice(0, 3)).toEqual([null, null, null]);
    expect(frames?.passes?.draws.slice(0, 3)).toEqual([null, null, null]);
    expect(read("editor.perf.detail", { from: 10, to: 20 })).toMatchObject({
      source: "agent",
      reason: "no-detail"
    });
    expect(read("editor.perf.passes")).toMatchObject({ source: "agent" });
    expect(editor.perf.second().caps).toMatchObject({
      passOwners: false,
      passDraws: false,
      passFormat: false,
      sections: false,
      detail: false
    });
  });
});
