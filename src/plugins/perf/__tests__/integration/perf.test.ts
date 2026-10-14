/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's lines and perf's values */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import type { Json } from "../../../registry/protocol";
import type { GameLike } from "../../../registry/types";
import { perfPlugin } from "../..";
import { createPerfWindow, readWireWindow } from "../../protocol";
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
    const spike = monitor.commit({ t: 1501, gapMs: 25.1, causes: 0b1 });
    commitFrames(monitor, 30, 1526.1, 16.7);
    vi.advanceTimersByTime(250);

    let count = 0;
    editor.perf.readWindow(window => {
      count = window.count;
    });
    expect(count).toBe(61);
    expect(editor.perf.spikes()).toMatchObject([{ frame: spike, cause: "gap", ms: 25.1 }]);

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
