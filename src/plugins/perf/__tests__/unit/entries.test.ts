/* eslint-disable unicorn/no-null -- null is "no input" and "no record" on the wire */
import { describe, expect, it } from "vitest";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import type { SourceEntry } from "../../../registry/types";
import { addPerfEntries, offText, watchTicks } from "../../entries";
import type { PerfWindowWire } from "../../protocol";
import { createPerfWindow, readWireWindow } from "../../protocol";
import { readTick } from "../../reader";
import { attach, commitFrames, perfState } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// entries: the five registry sources, their watches and the off reason.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * perf with a fake monitor and its sources added to a fake registry.
 *
 * @returns The perf, the monitor, a tick and the sources by id.
 */
function setup() {
  const perf = perfState();
  const monitor = createFakeMonitor({ capacity: 256 });
  attach(perf.state, monitor);
  const sources = new Map<string, SourceEntry>();
  addPerfEntries(
    {
      add: entry => {
        if ("read" in entry) sources.set(entry.descriptor.id, entry);
      }
    },
    perf.state,
    perf.config
  );
  const source = (id: string): SourceEntry => {
    const found = sources.get(id);
    if (found === undefined) throw new Error(`no source ${id}`);
    return found;
  };
  return { ...perf, monitor, sources, source, tick: () => readTick(perf.state, perf.config) };
}

describe("the perf sources", () => {
  it("adds the five sources with their ids, titles, inputs and changes: frame", () => {
    const { sources } = setup();
    expect([...sources.values()].map(entry => entry.descriptor)).toEqual([
      { id: "editor.perf.second", title: "Performance, this second", input: {}, changes: "frame" },
      { id: "editor.perf.window", title: "Frame graph", input: {}, changes: "frame" },
      { id: "editor.perf.spikes", title: "Spikes of the graph", input: {}, changes: "frame" },
      {
        id: "editor.perf.spike",
        title: "Spike record",
        input: { frame: "number" },
        changes: "frame"
      },
      { id: "editor.spikes", title: "Spikes", input: { lastMs: "number?" }, changes: "frame" }
    ]);
  });

  it("reads second, window, spikes and a spike record as wire values", () => {
    const { source, monitor, tick } = setup();
    commitFrames(monitor, 10, 1000, 16.7);
    const spike = monitor.commit({ t: 1167, gapMs: 30, workMs: 30, causes: 0b11 });
    commitFrames(monitor, 10, 1197, 16.7);
    tick();

    expect(source("editor.perf.second").read(null)).toMatchObject({ state: "on", spikes: 1 });
    const window = createPerfWindow(64);
    expect(readWireWindow(source("editor.perf.window").read(null), window)).toBe(true);
    expect([window.count, window.spikeCount]).toEqual([21, 1]);
    expect(source("editor.perf.spikes").read(null)).toMatchObject([{ frame: spike, cause: "js" }]);
    expect(source("editor.perf.spike").read({ frame: spike })).toMatchObject({
      frame: spike,
      detail: null
    });
    const wire = source("editor.perf.window").read(null) as PerfWindowWire;
    expect(wire.v).toBe(1);
  });

  it("answers null for a frame that is not a spike, and checks the input", () => {
    const { source, monitor, tick } = setup();
    commitFrames(monitor, 3, 0, 16.7);
    tick();
    expect(source("editor.perf.spike").read({ frame: 2 })).toBeNull();
    expect(() => source("editor.perf.spike").read({ frame: "2" })).toThrow("frame");
  });

  it("honours lastMs on the MCP mirror editor.spikes", () => {
    const { source, monitor, tick } = setup();
    monitor.commit({ t: 0, gapMs: 30, workMs: 30, causes: 0b11 });
    commitFrames(monitor, 100, 30, 16.7);
    tick();
    expect(source("editor.spikes").read({})).toHaveLength(1);
    expect(source("editor.spikes").read({ lastMs: 1000 })).toEqual([]);
    expect(source("editor.spikes").read(null)).toHaveLength(1);
  });

  it("probes the reason of a headless game and nothing with a monitor (bug: empty graphs without a reason)", () => {
    const { state, source } = setup();
    expect(source("editor.perf.window").probe?.()).toBeUndefined();
    state.off = "no-renderer";
    expect(offText(state)).toBe("the game has no renderer (headless)");
    expect(source("editor.perf.second").probe?.()).toBe("the game has no renderer (headless)");
    state.off = "no-monitor";
    expect(offText(state)).toBe(
      "the engine has no renderer.monitor (needs @moku-labs/game with the block 2b monitor)"
    );
  });
});

describe("watches", () => {
  it("are called after a tick that changed the window and not after an empty one", () => {
    const { source, monitor, tick } = setup();
    const values: unknown[] = [];
    source("editor.perf.second").watch(null, value => values.push(value));
    commitFrames(monitor, 3, 0, 16.7);
    tick();
    expect(values).toHaveLength(1);
    tick();
    expect(values).toHaveLength(1);
  });

  it("have an idempotent remover", () => {
    const { state } = setup();
    let calls = 0;
    const off = watchTicks(state, () => {
      calls += 1;
    });
    const other = watchTicks(state, () => undefined);
    off();
    off();
    expect(state.watchers.size).toBe(1);
    for (const watcher of state.watchers) watcher();
    expect(calls).toBe(0);
    other();
    expect(state.watchers.size).toBe(0);
  });
});
