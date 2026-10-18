/* eslint-disable unicorn/no-null -- null is perf's "none" */
import { describe, expect, it } from "vitest";
import {
  detailNote,
  inspectorView,
  noRateText,
  rangeHeadline,
  rangeTitle,
  systemsNotes
} from "../../derive/inspector";
import { appendEvents, appendFrames } from "../../source/contract";
import { createRenderViewState } from "../../state";
import type { InspectorView, MissionState } from "../../types";
import { sampleOf, secondOf } from "../device-fixtures";
import { CONFIG } from "../helpers";
import { bitsOf, eventsOf, line, rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/inspector.ts (spec 09 § M10): the summary of the view and the range
// view of a selection.
// ─────────────────────────────────────────────────────────────────────────────

/** A range view, narrowed. */
type RangeView = Extract<InspectorView, { kind: "range" }>;

/**
 * Mission control with 6 s at 60 fps from page-clock 10 s (frames 1–360) and seven single-frame spikes,
 * one three-frame GPU spike, systems on every row; a GC at f100 and a rate change at f200.
 *
 * @param systems - Whether the rows carry the top 5 systems.
 * @returns The mission state.
 */
function mission(systems = true): MissionState {
  const { mission: state } = createRenderViewState({ config: CONFIG });
  const rows = rowsOf(1, 360, {
    t0: 10_000,
    each: index => {
      const frame = index + 1;
      const base = {
        systems: [
          ["ward.update", 4],
          ["fog.render", 1]
        ] as const,
        jsMs: 5
      };
      if (frame >= 300 && frame <= 302) return { ...base, ms: 30, causes: bitsOf("gpu") };
      if (frame % 40 === 0) return { ...base, ms: 25, causes: bitsOf("js") };
      return base;
    }
  });
  appendFrames(state.history, wireOf(rows, { systems }));
  appendEvents(
    state.history,
    eventsOf([
      line.gc(10_000 + 99 * 16.67, 100, 4.2),
      line.rate(10_000 + 199 * 16.67, 200, 120, 60)
    ])
  );
  return state;
}

/** The view's end over the 360 frames. */
const END = 10_000 + 360 * 16.67;

describe("summary", () => {
  it("lists ≤ 5 spikes newest first with 'N more spikes in view', GCs and rate changes", () => {
    // Bug: the oldest spikes listed first, or every spike of the view in the column.
    const view = inspectorView(mission(), END);
    if (view?.kind !== "summary") throw new Error("expected the summary");
    expect(view.title).toBe("Last 6 s");
    expect(view.spikes.map(spike => [spike.from, spike.to])).toEqual([
      [360, 360],
      [320, 320],
      [300, 302],
      [280, 280],
      [240, 240]
    ]);
    expect(view.moreSpikes).toBe(5);
    expect(view.systems.map(system => system.name)).toEqual(["ward.update", "fog.render"]);
    expect(view.gcs).toEqual([{ frame: 100, freedMb: 4.2, pauseMs: 2 }]);
    expect(view.rates).toEqual([{ frame: 200, from: 120, to: 60, why: "missed frames" }]);
  });

  it("a multi-frame spike row selects all its frames", () => {
    // Bug: "GPU ×3" selecting its first frame only.
    const view = inspectorView(mission(), END);
    const gpu =
      view?.kind === "summary" ? view.spikes.find(spike => spike.cause === "gpu") : undefined;
    expect(gpu).toMatchObject({ from: 300, to: 302, label: "GPU sustained ×3" });
  });

  it("a paused view says '{span} in view'; without frames there is no inspector", () => {
    // Bug: "Last 6 s" over a view rewound a minute ago.
    const state = mission();
    state.view.live = false;
    expect(
      inspectorView(state, END)?.kind === "summary" && inspectorView(state, END)
    ).toMatchObject({ title: "6 s in view" });
    const { mission: empty } = createRenderViewState({ config: CONFIG });
    expect(inspectorView(empty, END)).toBeUndefined();
  });
});

describe("range", () => {
  it("range systems read every system when the detail carried them, else the top 5 with the note, and 'Prorated' when rangeSummary flags perSecond", () => {
    // Bug: a partial list of systems shown as complete.
    const state = mission();
    state.selection = { from: 100, to: 150 };
    const top5 = inspectorView(state, END) as RangeView;
    expect(top5.detail).toBe("top5");
    expect(systemsNotes(top5)).toEqual(["Top 5 systems per frame."]);

    state.detail = { kind: "shown", range: { from: 100, to: 150 }, reason: null, nodes: null };
    const full = inspectorView(state, END) as RangeView;
    expect(full.detail).toBe("full");
    expect(systemsNotes(full)).toEqual([]);

    state.detail = { kind: "loading", range: { from: 100, to: 150 } };
    expect((inspectorView(state, END) as RangeView).detail).toBe("loading");

    const perSecond = mission(false);
    perSecond.selection = { from: 100, to: 150 };
    perSecond.history.samples[0] = sampleOf({ frame: 160, frames: 60 });
    perSecond.history.sampleCount = 1;
    const prorated = inspectorView(perSecond, END) as RangeView;
    expect(prorated.detail).toBe("per-second");
    expect(systemsNotes(prorated)).toEqual([
      "Top 5 systems per frame.",
      "Prorated from per-second totals."
    ]);
  });

  it("node hows map to words (redraw → redrawn, mark → updated); a null label reads 'entity {n}'", () => {
    // Bug: the engine's words "mark" and "loose" shown to the person.
    const state = mission();
    state.selection = { from: 100, to: 150 };
    state.detail = {
      kind: "shown",
      range: { from: 100, to: 150 },
      reason: "no-detail",
      nodes: [
        { entity: 1, label: "fogLayer", how: "redraw", count: 12 },
        { entity: 1, label: "fogLayer", how: "redraw", count: 8 },
        { entity: 2, label: null, how: "mark", count: 2 },
        { entity: 3, label: "hud", how: "loose", count: 1 }
      ]
    };
    expect((inspectorView(state, END) as RangeView).nodes).toEqual([
      { label: "fogLayer", how: "redrawn", count: 20 },
      { label: "entity 2", how: "updated", count: 2 },
      { label: "hud", how: "loosened", count: 1 }
    ]);
  });

  it("'of range' divides by the range's JS work; files skip engine systems and unresolved names", () => {
    // Bug: a system's share of the frame time read as its share of the work.
    const state = mission();
    state.selection = { from: 100, to: 149 };
    state.files.set("ward.update", { path: "src/systems/ward.ts", line: 12 });
    state.files.set("fog.render", null);
    const view = inspectorView(state, END) as RangeView;
    expect(view.systems[0]).toEqual({ name: "ward.update", totalMs: 200, share: 0.8, maxMs: 4 });
    expect(view.files).toEqual([{ path: "src/systems/ward.ts", line: 12, system: "ward.update" }]);
  });

  it("a one-frame range reads 'One frame, …'; duration under 1 s has two decimals", () => {
    // Bug: "1 frames, 0 s".
    const state = mission();
    state.selection = { from: 300, to: 300 };
    const one = inspectorView(state, END) as RangeView;
    expect(rangeHeadline(one)).toBe("One frame, 0.03 s, worst 30 ms");
    expect(rangeTitle({ from: 300, to: 300 })).toBe("f300");
    state.selection = { from: 100, to: 159 };
    const many = inspectorView(state, END) as RangeView;
    expect(rangeHeadline(many)).toBe("60 frames, 0.99 s, worst 25 ms");
    expect(rangeTitle({ from: 100, to: 159 })).toBe("f100–f159");
  });

  it("pinned shows 'Adaptive is off: pinned at 120 fps'; the detail notes say why the view is partial", () => {
    // Bug: "No rate change" while the rate is pinned (no change can happen).
    expect(
      noRateText(
        secondOf({
          rate: { fps: 120, mode: "fixed", reason: "start", displayHz: 120, switches: 0 }
        })
      )
    ).toBe("Adaptive is off: pinned at 120 fps");
    expect(noRateText(secondOf())).toBe("No rate change in view, running 60 fps");
    const range = { from: 1, to: 2 };
    expect(detailNote({ kind: "shown", range, reason: "gone", nodes: null }, "Galaxy A26")).toBe(
      "The phone no longer holds this range in full."
    );
    expect(detailNote({ kind: "shown", range, reason: "no-detail", nodes: null }, "x")).toBe(
      "This engine has no range detail."
    );
    expect(detailNote({ kind: "shown", range, reason: "control", nodes: null }, "x")).toBe(
      "Range detail needs a debug build."
    );
    expect(detailNote({ kind: "loading", range }, "Galaxy A26")).toBe(
      "Reading the full range from Galaxy A26…"
    );
    expect(detailNote({ kind: "failed", range, message: "x" }, "x")).toBe(
      "Could not read the full range."
    );
    expect(detailNote({ kind: "idle" }, "x")).toBeUndefined();
  });

  it("lists the range's GCs with their pause, rate changes, compiles and the object counters that changed", () => {
    // Bug: a range view missing the GC that explains its worst frame.
    const state = mission();
    appendEvents(
      state.history,
      eventsOf([line.shader(10_000 + 120 * 16.67, 121, "fog.blur", 31)], 3)
    );
    state.selection = { from: 90, to: 210 };
    const view = inspectorView(state, END) as RangeView;
    expect(view.gcs).toEqual([{ frame: 100, freedMb: 4.2, pauseMs: 2 }]);
    expect(view.rates).toEqual([{ frame: 200, from: 120, to: 60, why: "missed frames" }]);
    expect(view.compiles).toEqual([{ frame: 121, label: "fog.blur", ms: 31, by: "fogLayer" }]);
    expect(view.objects).toEqual([]);
  });
});

describe("edges", () => {
  it("a failed detail falls back to the top 5; without a rate the empty line names no rate", () => {
    // Bug: a failed detail read leaving the range on "loading" forever.
    const state = mission();
    state.selection = { from: 100, to: 150 };
    state.detail = { kind: "failed", range: { from: 100, to: 150 }, message: "timeout" };
    expect((inspectorView(state, END) as RangeView).detail).toBe("top5");
    expect(noRateText(undefined)).toBe("No rate change in view");
    expect(
      noRateText(
        secondOf({ rate: { fps: null, mode: null, reason: null, displayHz: null, switches: 0 } })
      )
    ).toBe("No rate change in view");
  });
});
