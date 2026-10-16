// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is perf's "not measured" */
import { beforeEach, describe, expect, it } from "vitest";
import { runOverdraw, runSection } from "../../actions/sections";
import { NEEDS_DEBUG } from "../../derive/monitoring";
import type { PerfMonitorState } from "../../source/contract";
import { SECTION_DEFAULTS } from "../../source/contract";
import { secondOf } from "../device-fixtures";
import { type MissionCtx, missionCtx } from "../mission-ctx";

// ─────────────────────────────────────────────────────────────────────────────
// actions/sections.ts (spec 09 § M7 Monitoring): editor.perf.sections with a
// row's keys, flipped after the answer; game.debug { overdraw }.
// ─────────────────────────────────────────────────────────────────────────────

const MONITOR: PerfMonitorState = {
  engine: true,
  sections: SECTION_DEFAULTS,
  feeds: { passes: false, systems: true, nodes: false },
  costMs: null,
  monitorMs: null,
  editorMs: null,
  overdraw: false
};

let ctx: MissionCtx;

beforeEach(() => {
  ctx = missionCtx();
  ctx.state.mission.second = { ...secondOf(), monitor: MONITOR };
});

describe("runSection", () => {
  it("setSection('nodes', true) runs { nodes: true } and nothing else; Shaders & passes runs passes and shaders", async () => {
    // Bug: the Nodes sub-row switching Systems timing too.
    void runSection(ctx, "nodes", true);
    expect(ctx.runs.at(-1)).toMatchObject({ id: "editor.perf.sections", input: { nodes: true } });
    ctx.runs.at(-1)?.resolve({
      ...MONITOR,
      feeds: { ...MONITOR.feeds, nodes: true },
      sections: { ...SECTION_DEFAULTS, nodes: true }
    });
    await Promise.resolve();
    const passes = runSection(ctx, "passes", true);
    expect(ctx.runs.at(-1)).toMatchObject({ input: { passes: true, shaders: true } });
    ctx.runs.at(-1)?.resolve(MONITOR);
    await passes;
  });

  it("the switch flips only after the answer, and the answer's sections record has a nodes entry", async () => {
    // Bug: a switch shown on before the device agreed (it may refuse).
    const answer = runSection(ctx, "nodes", true);
    expect(ctx.state.mission.sectionPending).toBe("nodes");
    expect(ctx.state.mission.second?.monitor?.feeds.nodes).toBe(false);
    ctx.runs.at(-1)?.resolve({
      ...MONITOR,
      feeds: { ...MONITOR.feeds, nodes: true },
      sections: { ...SECTION_DEFAULTS, nodes: true }
    });
    const result = await answer;
    expect(result.sections?.nodes).toBe("on");
    expect(ctx.state.mission.second?.monitor?.feeds.nodes).toBe(true);
    expect(ctx.state.mission.sectionPending).toBeUndefined();
  });

  it("a dev-only refusal toasts and shows the current state", async () => {
    // Bug: a refused switch shown as flipped, or refused silently.
    const answer = runSection(ctx, "gpu", false);
    ctx.runs.at(-1)?.reject({ data: { reason: "dev_only" } });
    const result = await answer;
    expect(result).toMatchObject({ ok: false, text: NEEDS_DEBUG, sections: { gpu: "on" } });
    expect(ctx.workspace.toast).toHaveBeenCalledWith(NEEDS_DEBUG);
  });

  it("Frames and Render stats are always measured and run nothing; one switch at a time", async () => {
    // Bug: a Frames switch that stops the base every graph needs.
    const frames = await runSection(ctx, "frames", false);
    const render = await runSection(ctx, "render", false);
    expect(frames.text).toBe("Frames are always measured");
    expect(render.text).toBe("Render stats are always measured");
    void runSection(ctx, "gpu", false);
    const busy = await runSection(ctx, "memory", false);
    expect(busy.text).toBe("Busy: a monitoring switch is still pending");
    expect(ctx.runs).toHaveLength(1);
  });
});

describe("runOverdraw", () => {
  it("runs game.debug { overdraw } and resolves the engine's flag; a refusal keeps the old flag with a toast", async () => {
    // Bug: the heat map shown as on after the build refused it.
    const on = runOverdraw(ctx, true);
    expect(ctx.runs.at(-1)).toMatchObject({ id: "game.debug", input: { overdraw: true } });
    ctx.runs.at(-1)?.resolve({ overdraw: true });
    expect(await on).toBe(true);

    const refused = runOverdraw(ctx, true);
    ctx.runs.at(-1)?.reject({ data: { reason: "read_only" } });
    expect(await refused).toBe(false);
    expect(ctx.workspace.toast).toHaveBeenCalledWith(NEEDS_DEBUG);
    expect(ctx.state.mission.sectionPending).toBeUndefined();
  });
});
