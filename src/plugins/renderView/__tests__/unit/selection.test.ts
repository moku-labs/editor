/* eslint-disable unicorn/no-null -- null is a value of the wire and of perf's types */
import { describe, expect, it } from "vitest";
import { appendEvents, appendFrames, clearPerfHistory } from "../../source/contract";
import { createRenderViewState } from "../../state";
import type { MissionState } from "../../types";
import {
  dropStaleSelection,
  jumpTo,
  noJumpText,
  rangeOfDrag,
  selectRange,
  stepFrame
} from "../../view/selection";
import { CONFIG } from "../helpers";
import { bitsOf, eventsOf, line, rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// view/selection.ts (spec 09 § M11): a click or a drag selects frames, any
// selection pauses and is scrolled into view, step and jump move it, and a
// selection whose frames left the history is cleared.
// ─────────────────────────────────────────────────────────────────────────────

/** liveEnd() of the tests: just before the newest row. */
const LIVE = 69_000;

/** The page-clock time of a frame of the test rows. */
function timeOf(frame: number): number {
  return 10_000 + (frame - 1) * 16.67;
}

/**
 * Mission control with 3600 rows from frame 1 (page-clock 10 s, 60 fps): a GPU spike group
 * f1000–f1002, a JS spike at f2000; a GC at f1500 and a rate change at f2500.
 *
 * @returns The mission state.
 */
function mission(): MissionState {
  const state = createRenderViewState({ config: CONFIG });
  const rows = rowsOf(1, 3600, {
    t0: 10_000,
    each: index => {
      const frame = index + 1;
      if (frame >= 1000 && frame <= 1002) return { ms: 30, causes: bitsOf("gpu") };
      if (frame === 2000) return { ms: 41, causes: bitsOf("js") };
      return {};
    }
  });
  appendFrames(state.mission.history, wireOf(rows));
  appendEvents(
    state.mission.history,
    eventsOf([line.gc(timeOf(1500), 1500, 4.2), line.rate(timeOf(2500), 2500, 120, 60)])
  );
  return state.mission;
}

describe("rangeOfDrag", () => {
  it("a click selects one frame, a 3 px drag does not make a range, a 4 px drag does", () => {
    // Bug: a shaky click turns into a two-frame range (or a short drag is ignored).
    expect(rangeOfDrag(10, 20, 0)).toEqual({ from: 10, to: 10 });
    expect(rangeOfDrag(10, 20, 3)).toEqual({ from: 10, to: 10 });
    expect(rangeOfDrag(10, 20, 4)).toEqual({ from: 10, to: 20 });
    expect(rangeOfDrag(20, 10, 9)).toEqual({ from: 10, to: 20 });
  });
});

describe("selectRange", () => {
  it("any selection pauses at the live end and bumps the version", () => {
    // Bug: a selection that scrolls away under the live clock.
    const state = mission();

    const kept = selectRange(state, { from: 3500, to: 3510 }, LIVE);

    expect(kept).toEqual({ from: 3500, to: 3510 });
    expect(state.view).toMatchObject({ live: false });
    expect(state.selectionVersion).toBe(1);
  });

  it("clamps to the history; a range with no frame held keeps nothing", () => {
    // Bug: a range reaching past the newest frame, or a selection of frames long gone.
    const state = mission();

    expect(selectRange(state, { from: 3590, to: 9000 }, LIVE)).toEqual({ from: 3590, to: 3600 });
    expect(selectRange(state, { from: 9000, to: 9100 }, LIVE)).toBeUndefined();
    expect(state.selection).toEqual({ from: 3590, to: 3600 });
  });

  it("a selected frame in the outer 8 % is re-centred at 45 %; one in the middle stays", () => {
    // Bug: stepping to a frame at the edge leaves it half off the plot.
    const state = mission();
    state.view.live = false;
    state.view.endMs = LIVE;

    selectRange(state, { from: 3193, to: 3193 }, LIVE);
    const start = state.view.endMs - state.view.span;
    expect((timeOf(3193) - start) / state.view.span).toBeCloseTo(0.45, 2);

    const end = state.view.endMs;
    selectRange(state, { from: 3200, to: 3200 }, LIVE);
    expect(state.view.endMs).toBe(end);
  });

  it("undefined clears the selection", () => {
    // Bug: Esc leaves the old range highlighted.
    const state = mission();
    selectRange(state, { from: 10, to: 20 }, LIVE);

    expect(selectRange(state, undefined, LIVE)).toBeUndefined();
    expect(state.selection).toBeUndefined();
    expect(state.selectionVersion).toBe(2);
  });
});

describe("stepFrame", () => {
  it("steps one frame from the selection's edge; at the newest frame it stays", () => {
    // Bug: → past the newest frame selects nothing and loses the selection.
    const state = mission();
    selectRange(state, { from: 3598, to: 3599 }, LIVE);

    expect(stepFrame(state, 1, LIVE)).toBe(3600);
    expect(stepFrame(state, 1, LIVE)).toBeUndefined();
    expect(state.selection).toEqual({ from: 3600, to: 3600 });
    expect(stepFrame(state, -1, LIVE)).toBe(3599);
  });

  it("without a selection selects the frame at the centre of the view; without frames nothing", () => {
    // Bug: the first → of a paused view jumps to frame 1.
    const state = mission();
    state.view.live = false;
    state.view.endMs = 40_000;

    const frame = stepFrame(state, 1, LIVE) ?? 0;
    expect(Math.abs(timeOf(frame) - 37_000)).toBeLessThan(17);

    clearPerfHistory(state.history);
    expect(stepFrame(state, 1, LIVE)).toBeUndefined();
  });
});

describe("jumpTo", () => {
  it("jump finds the next spike group from the selection's edge and selects the whole group", () => {
    // Bug: Shift+→ selects only the first frame of "GPU ×3".
    const state = mission();
    selectRange(state, { from: 500, to: 500 }, LIVE);

    expect(jumpTo(state, "spike", 1, LIVE)).toEqual({ from: 1000, to: 1002 });
    expect(jumpTo(state, "spike", 1, LIVE)).toEqual({ from: 2000, to: 2000 });
    expect(jumpTo(state, "spike", -1, LIVE)).toEqual({ from: 1000, to: 1002 });
    expect(jumpTo(state, "spike", -1, LIVE)).toBeUndefined();
    expect(state.selection).toEqual({ from: 1000, to: 1002 });
  });

  it("finds GCs and rate changes from the events; without a selection it searches from the view end", () => {
    // Bug: the GC stepper searches frames for a cause the rows never carry.
    const state = mission();

    expect(jumpTo(state, "rate", -1, LIVE)).toEqual({ from: 2500, to: 2500 });
    expect(jumpTo(state, "gc", -1, LIVE)).toEqual({ from: 1500, to: 1500 });
    expect(jumpTo(state, "gc", 1, LIVE)).toBeUndefined();
  });

  it("jump without a match says where it looked", () => {
    // Bug: a silent no-op, or "earlier" said for a search forward.
    expect(noJumpText("spike", 1)).toBe("No spike after this point");
    expect(noJumpText("spike", -1)).toBe("No spike earlier in the 2 min history");
    expect(noJumpText("gc", 1)).toBe("No GC after this point");
    expect(noJumpText("rate", -1)).toBe("No rate change earlier in the 2 min history");
  });
});

describe("dropStaleSelection", () => {
  it("a selection whose first frame leaves the history is cleared", () => {
    // Bug: a dangling range drawn over frames that are no longer there.
    const state = mission();
    selectRange(state, { from: 5, to: 50 }, LIVE);

    expect(dropStaleSelection(state)).toBe(false);
    appendFrames(state.history, wireOf(rowsOf(3601, 60, { t0: 10_000 + 120_010 })));

    expect(dropStaleSelection(state)).toBe(true);
    expect(state.selection).toBeUndefined();
  });
});

describe("events between frames", () => {
  it("a rate change between two frames is found at the frame its time falls in", () => {
    // Bug: game.frameRate switches (frame null) never reachable with the rate stepper.
    const state = mission();
    appendEvents(
      state.history,
      eventsOf([line.rate(timeOf(3000) + 5, null, 60, 120, "headroom")], 3)
    );
    selectRange(state, { from: 2600, to: 2600 }, LIVE);
    expect(jumpTo(state, "rate", 1, LIVE)).toEqual({ from: 3000, to: 3000 });
  });
});
