import { describe, expect, it } from "vitest";
import { appendFrames } from "../../source/contract";
import { createRenderViewState } from "../../state";
import type { MissionState } from "../../types";
import { noteArrival } from "../../view/clock";
import {
  behindMs,
  clockEnd,
  keepInHistory,
  liveView,
  pauseView,
  seekView,
  setViewSpan,
  viewEnd
} from "../../view/view";
import { CONFIG } from "../helpers";
import { rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// view/view.ts (spec 09 § M11): live, pause, seek, the span, and the view kept
// inside the 2-minute history.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mission control's state with a history of 60 s of rows from page-clock 10 s.
 *
 * @returns The mission state.
 */
function missionWithRows(): MissionState {
  const state = createRenderViewState({ config: CONFIG });
  appendFrames(state.mission.history, wireOf(rowsOf(1, 3600, { t0: 10_000 })));
  return state.mission;
}

describe("pause and live", () => {
  it("pause freezes the view end while the history keeps filling and behind grows", () => {
    // Bug: a paused view that drifts with the clock.
    const mission = missionWithRows();

    expect(pauseView(mission.view, 50_000)).toBe(true);

    expect(viewEnd(mission.view, 60_000)).toBe(50_000);
    expect(behindMs(mission.view, 60_000)).toBe(10_000);
    expect(behindMs(mission.view, 61_500)).toBe(11_500);
  });

  it("pause does nothing before the first frames arrived", () => {
    // Bug: a "paused" view at end 0, frozen before any data.
    const mission = missionWithRows();

    expect(pauseView(mission.view, undefined)).toBe(false);
    expect(mission.view.live).toBe(true);
  });

  it("live clears the selection and follows the clock again", () => {
    // Bug: Back to live keeps a range the live view scrolls away from.
    const mission = missionWithRows();
    pauseView(mission.view, 50_000);
    mission.selection = { from: 10, to: 20 };
    const version = mission.selectionVersion;

    liveView(mission);

    expect(mission.view.live).toBe(true);
    expect(mission.selection).toBeUndefined();
    expect(mission.selectionVersion).toBe(version + 1);
    expect(viewEnd(mission.view, 61_000)).toBe(61_000);
    expect(behindMs(mission.view, 61_000)).toBe(0);
  });
});

describe("seek", () => {
  it("seek clamps into the history", () => {
    // Bug: a view past live, or one that starts before the oldest frame.
    const mission = missionWithRows();

    seekView(mission.view, 999_999, mission.history, 69_000);
    expect(mission.view).toMatchObject({ live: false, endMs: 69_000 });

    seekView(mission.view, 0, mission.history, 69_000);
    expect(mission.view.endMs).toBe(16_000);
  });
});

describe("span", () => {
  it("a span change keeps the view end", () => {
    // Bug: switching 6 s to 30 s jumps a paused view back to live.
    const mission = missionWithRows();
    pauseView(mission.view, 50_000);

    setViewSpan(mission.view, 30_000);

    expect(mission.view).toMatchObject({ live: false, endMs: 50_000, span: 30_000 });
  });

  it("a paused view whose start leaves the history is pushed forward", () => {
    // Bug: a rewound view that shows an empty left part after the oldest rows dropped.
    const mission = missionWithRows();
    pauseView(mission.view, 20_000);
    setViewSpan(mission.view, 30_000);

    keepInHistory(mission.view, mission.history, 69_000);

    expect(mission.view.endMs).toBe(40_000);

    mission.view.live = true;
    mission.view.endMs = 0;
    keepInHistory(mission.view, mission.history, 69_000);
    expect(mission.view.endMs).toBe(0);
  });
});

describe("clockEnd", () => {
  it("is the clock's right edge now, undefined before the first arrival", () => {
    // Bug: an api pause that freezes at 0 before the poll answered.
    const mission = missionWithRows();

    expect(clockEnd(mission.clock, 1000)).toBeUndefined();
    noteArrival(mission.clock, 70_000, 1000);
    expect(clockEnd(mission.clock, 1000)).toBe(69_000);
  });
});

describe("reduced motion", () => {
  it("outside the loop the live end follows the mode the loop last painted in", () => {
    // Bug: a pause under reduced motion jumping a delay back from what is shown.
    const mission = missionWithRows();
    noteArrival(mission.clock, 70_000, 1000);
    expect(clockEnd(mission.clock, 1000)).toBe(69_000);
    mission.clock.stepMs = 70_000;
    mission.clock.stepAt = 2000;
    expect(clockEnd(mission.clock, 2100)).toBe(70_000);
  });
});
