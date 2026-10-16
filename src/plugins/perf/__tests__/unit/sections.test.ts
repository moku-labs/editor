/* eslint-disable unicorn/no-null -- null is "no header" in the fake monitor */
import { describe, expect, it, vi } from "vitest";
import {
  createFakeMonitor,
  headerLine,
  patchedSampleLine,
  sectionsLine
} from "../../../../../tests/fixtures/fake-monitor";
import { initPerf, startPerf, stopPerf } from "../../lifecycle";
import type { PerfMonitorState } from "../../protocol";
import { SECTION_DEFAULTS } from "../../protocol";
import { secondOf } from "../../records";
import { feedRig, perfCtx, perfState } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// editor.perf.sections (spec 03 Delta 2026-10-16 D7): switches perf's own feeds
// and, on an engine that can, the engine's monitoring sections; a refusal of the
// build is the registry's -32009 after the feeds switched.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs `editor.perf.sections` with an input and answers its value.
 *
 * @param run - The command's run.
 * @param input - The switches.
 * @returns The monitor state it answered.
 */
async function switched(
  run: (raw: Record<string, boolean>) => Promise<{ value: unknown }>,
  input: Record<string, boolean>
): Promise<PerfMonitorState> {
  const { value } = await run(input);
  return value as PerfMonitorState;
}

describe("editor.perf.sections", () => {
  it("switches the feed and the engine's section together and answers their state (bug: the popover shows on while the engine stays off)", async () => {
    const { command, monitor, state } = feedRig();
    const answer = await switched(raw => command("editor.perf.sections").run(raw), {
      passes: true
    });
    expect(monitor.controlCalls).toEqual([
      { method: "sections", input: { passes: true }, inAgent: true }
    ]);
    expect(answer).toMatchObject({
      engine: true,
      sections: { ...SECTION_DEFAULTS, passes: true },
      feeds: { passes: true, systems: true, nodes: false }
    });
    expect(state.feeds.passes).toBe(true);
    expect(secondOf(state).monitor).toEqual(answer);
  });

  it("rejects a write the build refuses as -32009 with its reason and still switches perf's feed (bug: a refusal that also leaves the editor side off, or shows as failed)", async () => {
    for (const [mode, reason] of [
      ["dev-only", "dev_only"],
      ["read-only", "read_only"]
    ] as const) {
      const { command, state, monitor } = feedRig({}, { sections: mode });
      await expect(command("editor.perf.sections").run({ nodes: true })).rejects.toMatchObject({
        code: -32_009,
        data: { reason }
      });
      expect(state.feeds.nodes).toBe(true);
      expect(monitor.begins).toBe(monitor.ends);
    }
  });

  it("answers engine false and the default sections on an engine without monitor.sections (bug: a 0.15.x phone claiming engine sections)", async () => {
    const { command, monitor } = feedRig({}, { sections: "absent" });
    const answer = await switched(raw => command("editor.perf.sections").run(raw), {
      systems: false
    });
    expect(answer).toMatchObject({
      engine: false,
      sections: SECTION_DEFAULTS,
      feeds: { passes: false, systems: false, nodes: false }
    });
    expect(monitor.controlCalls).toEqual([]);
  });

  it("changes nothing for {} and answers the state, with the sample's costs (bug: a read that writes)", async () => {
    const { command, monitor, state } = feedRig();
    monitor.emit(patchedSampleLine(10, { monitorMs: 0.21, sectionsMs: { gpu: 0.01 } }));
    const answer = await switched(raw => command("editor.perf.sections").run(raw), {});
    expect(monitor.controlCalls).toEqual([]);
    expect(answer).toMatchObject({
      feeds: { passes: false, systems: true, nodes: false },
      costMs: { gpu: 0.01 },
      monitorMs: 0.21
    });
    expect(state.feeds).toEqual({ passes: false, systems: true, nodes: false });
  });

  it("refuses a switch that is not a boolean with -32602 (bug: 'yes' read as on)", async () => {
    const { command } = feedRig();
    await expect(command("editor.perf.sections").run({ passes: "yes" })).rejects.toMatchObject({
      code: -32_602
    });
  });
});

describe("the sections perf reports", () => {
  it("follow the header's sections, then the newest sections line (bug: the popover showing the engine's defaults after a switch)", () => {
    const sections = { ...SECTION_DEFAULTS, shaders: true };
    const { monitor, state } = feedRig({}, { header: headerLine({ sections }) });
    expect(secondOf(state).monitor?.sections).toEqual(sections);
    monitor.emit(sectionsLine({ on: ["passes"], off: ["shaders"] }));
    expect(secondOf(state).monitor?.sections).toEqual({ ...SECTION_DEFAULTS, passes: true });
  });

  it("read monitor.sections once at start (bug: a phone whose engine keeps passes on shown with the defaults)", () => {
    vi.useFakeTimers();
    const perf = perfState();
    const monitor = createFakeMonitor({ header: null });
    const registry = { game: () => ({ renderer: { monitor } }), add: () => undefined };
    const { ctx } = perfCtx(perf, registry);
    initPerf(ctx);
    startPerf(ctx);
    expect(monitor.controlCalls).toEqual([{ method: "sections", input: undefined, inAgent: true }]);
    expect(secondOf(perf.state).monitor?.engine).toBe(true);
    stopPerf(ctx);
    vi.useRealTimers();
  });
});
