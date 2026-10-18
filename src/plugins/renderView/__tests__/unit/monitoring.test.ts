/* eslint-disable unicorn/no-null -- null is perf's "not measured" */
import { describe, expect, it } from "vitest";
import { wireError } from "../../../registry/protocol";
import {
  alwaysOn,
  costText,
  monitoringRows,
  monitoringTotals,
  NEEDS_DEBUG,
  sectionKeys,
  sectionsAnswerOf,
  sectionsInput,
  sectionsRefusalOf,
  sectionsView
} from "../../derive/monitoring";
import type { PerfCaps, PerfMonitorState } from "../../source/contract";
import { SECTION_DEFAULTS } from "../../source/contract";

// ─────────────────────────────────────────────────────────────────────────────
// derive/monitoring.ts (spec 09 § M7 Monitoring popover): rows, costs, totals
// and the editor.perf.sections keys a row sends.
// ─────────────────────────────────────────────────────────────────────────────

const CAPS: PerfCaps = {
  passOwners: true,
  passDraws: true,
  passFormat: true,
  systemNames: true,
  shaderEvents: true,
  problems: true,
  gc: true,
  sections: true,
  detail: false,
  passesLine: false,
  gpuTimer: true,
  heap: "trusted"
};

/**
 * A monitoring state with the engine's sections.
 *
 * @param overrides - Field overrides.
 * @returns The state.
 */
function monitorOf(overrides: Partial<PerfMonitorState> = {}): PerfMonitorState {
  return {
    engine: true,
    sections: SECTION_DEFAULTS,
    feeds: { passes: false, systems: true, nodes: false },
    costMs: {
      gpu: 0.01,
      passes: 0.2,
      shaders: 0.1,
      problems: 0.004,
      memory: 0.005,
      systems: 0.04,
      nodes: 0.3,
      longFrames: 0
    },
    monitorMs: 0.21,
    editorMs: 0.12,
    overdraw: false,
    ...overrides
  };
}

describe("rows and keys", () => {
  it("each UI row sends exactly its editor.perf.sections keys", () => {
    // Bug: a switch that turns the wrong section off (Nodes switching Systems timing).
    expect(sectionsInput("systems", false)).toEqual({ systems: false });
    expect(sectionsInput("nodes", true)).toEqual({ nodes: true });
    expect(sectionsInput("passes", true)).toEqual({ passes: true, shaders: true });
    expect(sectionsInput("gpu", false)).toEqual({ gpu: false });
    expect(sectionsInput("memory", true)).toEqual({ memory: true });
  });

  it("Frames and Render stats have no switch", () => {
    // Bug: a Frames switch that stops the base measurement every graph needs.
    const rows = monitoringRows({
      monitor: monitorOf(),
      caps: CAPS,
      memoryMeasured: true,
      control: true
    });
    const fixed = rows.filter(row => row.section === "frames" || row.section === "render");
    expect(fixed.map(row => [row.switchable, row.note, row.state])).toEqual([
      [false, "always on", "on"],
      [false, "always on", "on"]
    ]);
    expect(sectionKeys("frames")).toBeUndefined();
    expect(sectionsInput("render", false)).toBeUndefined();
    expect(alwaysOn("frames").text).toBe("Frames are always measured");
    expect(alwaysOn("render").text).toBe("Render stats are always measured");
  });

  it("monitor.engine false leaves only the perf feeds switchable and disables GPU timing and Memory with 'needs a newer engine'", () => {
    // Bug: switches shown for sections the engine cannot turn off.
    const rows = monitoringRows({
      monitor: monitorOf({ engine: false, costMs: null }),
      caps: CAPS,
      memoryMeasured: true,
      control: true
    });
    const switchable = rows.filter(row => row.switchable).map(row => row.section);
    expect(switchable).toEqual(["systems", "nodes", "passes"]);
    const engineRows = rows.filter(row => row.section === "gpu" || row.section === "memory");
    expect(engineRows.map(row => [row.state, row.note])).toEqual([
      ["unavailable", "needs a newer engine"],
      ["unavailable", "needs a newer engine"]
    ]);
  });

  it("without control every switch is disabled with the note", () => {
    // Bug: switches that toggle and then fail on a build without control.
    const rows = monitoringRows({
      monitor: monitorOf(),
      caps: CAPS,
      memoryMeasured: true,
      control: false
    });
    expect(rows.some(row => row.switchable)).toBe(false);
    expect(rows.find(row => row.section === "systems")?.note).toBe(NEEDS_DEBUG);
  });

  it("memory is unavailable on a source with no memory source; GPU without a timer", () => {
    // Bug: a Memory switch for an iPhone, which never sends a heap.
    const view = sectionsView(monitorOf(), { ...CAPS, gpuTimer: false }, false);
    expect(view?.memory).toBe("unavailable");
    expect(view?.gpu).toBe("unavailable");
    expect(sectionsView(undefined, CAPS, true)).toBeUndefined();
  });

  it("a feed row is on only when perf feeds it and the engine's section is on", () => {
    // Bug: Systems timing shown on while the engine's section is off (no data arrives).
    const view = sectionsView(
      monitorOf({
        sections: { ...SECTION_DEFAULTS, systems: false },
        feeds: { passes: true, systems: true, nodes: false }
      }),
      CAPS,
      true
    );
    expect(view).toMatchObject({
      systems: "off",
      passes: "off",
      nodes: "off",
      gpu: "on",
      memory: "on"
    });
  });
});

describe("costs", () => {
  it("a cost under 0.02 ms reads 'light'", () => {
    // Bug: "adds ~0.01 ms/frame" next to a free section, or 0.02 called light.
    expect(costText(0.019)).toEqual({ text: "light", tone: "live" });
    expect(costText(0.02)).toEqual({ text: "adds ~0.02 ms/frame", tone: "plain" });
    expect(costText(0.153)).toEqual({ text: "adds ~0.15 ms/frame", tone: "plain" });
  });

  it("a null cost reads 'cost not measured' and the total line says the engine does not measure it", () => {
    // Bug: the engine's estimates shown as measured.
    const monitor = monitorOf({ costMs: null });
    const rows = monitoringRows({ monitor, caps: CAPS, memoryMeasured: true, control: true });
    expect(rows.find(row => row.section === "systems")?.cost.text).toBe("cost not measured");
    const totals = monitoringTotals(monitor, rows, 16.7, true);
    expect(totals.footer).toBe("Cost on the game is not measured by this engine.");
    expect(totals.meter).toBeNull();
    expect(totals.button).toBe("3 on");
  });

  it("the total is the sum of the sections on, the meter is pct × 8 capped at 100", () => {
    // Bug: the cost of sections that are off counted in the total.
    const monitor = monitorOf();
    const rows = monitoringRows({ monitor, caps: CAPS, memoryMeasured: true, control: true });
    const totals = monitoringTotals(monitor, rows, 16.7, true);
    // On: gpu 0.01, problems 0.004, memory 0.005, systems 0.04, longFrames 0 = 0.059 → 0.1.
    expect(totals.costMs).toBe(0.1);
    expect(totals.meter).toBeCloseTo((0.059 / 16.7) * 100 * 8, 5);
    expect(totals.button).toBe("3 on, ~0.1 ms");
    expect(totals.note).toBe(
      "A section that is off stops collecting on the device, and its cards say so."
    );
    expect(totals.editor).toBe("The editor's own reading: ~0.12 ms a second");
    const heavy = monitorOf({
      costMs: { gpu: 5, memory: 0, problems: 0, systems: 0, longFrames: 0 }
    });
    expect(monitoringTotals(heavy, rows, 16.7, false).meter).toBe(100);
  });
});

describe("answers", () => {
  it("the answer's sections record has a nodes entry and is the truth shown", () => {
    // Bug: the Nodes sub-row missing from the answer, or the switch flipped before the answer.
    const answer = sectionsAnswerOf(
      "nodes",
      monitorOf({
        feeds: { passes: false, systems: true, nodes: true },
        sections: { ...SECTION_DEFAULTS, nodes: true }
      }),
      CAPS,
      true
    );
    expect(answer.ok).toBe(true);
    expect(answer.text).toBe("Nodes on");
    expect(answer.sections?.nodes).toBe("on");
    expect(sectionsAnswerOf("nodes", "nope", CAPS, true).ok).toBe(false);
  });

  it("a dev-only or read-only refusal reads 'Needs a debug build…'", () => {
    // Bug: a release build's refusal shown as a failure of the editor.
    expect(sectionsRefusalOf(wireError(-32_009, "x", { reason: "read_only" })).text).toBe(
      NEEDS_DEBUG
    );
    expect(sectionsRefusalOf({ data: { reason: "dev-only" } }).text).toBe(NEEDS_DEBUG);
    expect(sectionsRefusalOf(wireError(-32_003, "x", { reason: "no_session" })).text).toBe(
      "Not sent: no source connected"
    );
    expect(sectionsRefusalOf(new Error("[moku-editor] boom")).text).toBe("Refused: boom");
  });
});
