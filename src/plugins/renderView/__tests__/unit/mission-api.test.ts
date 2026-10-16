// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderViewApi } from "../../api";
import { appendEvents, appendFrames } from "../../source/contract";
import { subscribeMission } from "../../state";
import type { RenderViewApi } from "../../types";
import { noteArrival } from "../../view/clock";
import { secondOf } from "../device-fixtures";
import { type MissionCtx, missionCtx } from "../mission-ctx";
import { bitsOf, eventsOf, line, rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// api.ts — Mission control's members (spec 09 § M12 API): each changes the
// state and re-renders Mission control on its normal path, and does nothing on
// its no-op path (no frames, no source); mission() and inspect() return copies.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;
let api: RenderViewApi;
let renders: number;

/** The live end of the tests: the newest frame's end, a 1 s delay behind it. */
const NEWEST_END = 10_000 + 3600 * 16.67;

beforeEach(() => {
  vi.useFakeTimers();
  ctx = missionCtx();
  api = createRenderViewApi(ctx);
  renders = 0;
  subscribeMission(ctx.state.mission, () => {
    renders += 1;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Fills the history with a minute of frames (a JS spike at f1000) and starts the clock.
 */
function fill(): void {
  const { mission } = ctx.state;
  const rows = rowsOf(1, 3600, {
    t0: 10_000,
    each: index => (index === 999 ? { ms: 40, causes: bitsOf("js") } : {})
  });
  appendFrames(mission.history, wireOf(rows, { systems: false }));
  appendEvents(mission.history, eventsOf([line.gc(20_000, 601, 4)]));
  noteArrival(mission.clock, NEWEST_END, performance.now());
  mission.second = secondOf();
}

describe("without a source or frames", () => {
  it("mission() and inspect() are undefined without a source; pause and seek do nothing without frames", () => {
    // Bug: a paused view frozen at 0 before the first frames.
    ctx.state.mission.source = undefined;
    expect(api.mission()).toBeUndefined();
    expect(api.inspect()).toBeUndefined();
    ctx.state.mission.source = ctx.activeSource.current;
    api.pause();
    api.seek(5000);
    expect(ctx.state.mission.view.live).toBe(true);
    expect(renders).toBe(0);
    expect(api.step(1)).toBeUndefined();
  });
});

describe("with frames", () => {
  beforeEach(fill);

  it("mission() reports the source, the view and the header numbers, in copies", () => {
    // Bug: an MCP tool reading the live state and changing it.
    const view = api.mission();
    expect(view?.source).toEqual({
      session: "s-1",
      kind: "local",
      name: "Local preview",
      link: "local",
      state: "live"
    });
    expect(view?.live).toBe(true);
    expect(view?.stats.frames).toBeGreaterThan(300);
    expect(view?.stats.gcs).toBeNull();
    api.select({ from: 10, to: 20 });
    const selected = api.mission();
    expect(selected?.selection).toEqual({ from: 10, to: 20 });
    expect(selected?.selection).not.toBe(ctx.state.mission.selection);
  });

  it("pause freezes the view and live returns to it, clearing the selection", () => {
    // Bug: Back to live leaving the range highlighted.
    api.pause();
    expect(api.mission()?.live).toBe(false);
    api.select({ from: 100, to: 120 });
    api.live();
    expect(api.mission()).toMatchObject({ live: true, selection: undefined });
    expect(ctx.state.mission.detail).toEqual({ kind: "idle" });
    expect(renders).toBeGreaterThanOrEqual(3);
  });

  it("setSpan keeps the end; seek pauses and clamps into the history", () => {
    // Bug: a rewind past the oldest frame showing an empty plot.
    api.setSpan(30_000);
    expect(api.mission()?.span).toBe(30_000);
    api.seek(0);
    const { view } = ctx.state.mission;
    expect(view.live).toBe(false);
    expect(view.endMs).toBe(10_000 + 30_000);
    api.setSpan(120_000);
    expect(view.endMs).toBeGreaterThanOrEqual(NEWEST_END - 1000 - 1);
  });

  it("select keeps the range, starts the detail read and looks up its systems' files; undefined clears", () => {
    // Bug: a selection without its detail read (the inspector stays on the top 5 forever).
    expect(api.select({ from: 500, to: 600 })).toEqual({ from: 500, to: 600 });
    expect(ctx.state.mission.detail).toMatchObject({
      kind: "loading",
      range: { from: 500, to: 600 }
    });
    expect(api.inspect()?.kind).toBe("range");
    expect(api.select(undefined)).toBeUndefined();
    expect(ctx.state.mission.detail).toEqual({ kind: "idle" });
    expect(api.inspect()?.kind).toBe("summary");
  });

  it("step selects the next frame; jump finds the spike or toasts that there is none", () => {
    // Bug: Shift+→ silent at the end of the history.
    api.select({ from: 998, to: 998 });
    expect(api.step(1)).toBe(999);
    expect(api.jump("spike", 1)).toEqual({ from: 1000, to: 1000 });
    expect(api.jump("spike", 1)).toBeUndefined();
    expect(ctx.workspace.toast).toHaveBeenCalledWith("No spike after this point");
    expect(api.jump("gc", -1)).toEqual({ from: 601, to: 601 });
  });

  it("setRate, setSection, setOverdraw, record and mark run their commands on the active source", () => {
    // Bug: a member wired to the wrong command.
    const pending = [
      api.setRate(60),
      api.setSection("systems", false),
      api.setOverdraw(true),
      api.record(true),
      api.mark("boss")
    ];
    expect(pending).toHaveLength(5);
    expect(ctx.runs.map(run => [run.id, run.input])).toEqual([
      ["game.frameRate", { fps: 60 }],
      ["editor.perf.sections", { systems: false }],
      ["game.debug", { overdraw: true }],
      ["editor.record", { on: true }],
      ["editor.record", { mark: "boss" }]
    ]);
  });
});
