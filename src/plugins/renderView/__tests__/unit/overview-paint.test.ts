/* eslint-disable unicorn/no-null -- null is a value of the wire and of perf's types */
import { describe, expect, it } from "vitest";
import { noteRows } from "../../series/overview";
import { appendFrames, HISTORY_MS } from "../../source/contract";
import { createRenderViewState } from "../../state";
import { grabOffset, overviewTime, overviewX } from "../../timeline/hit";
import { boxLayout } from "../../timeline/layout";
import { paintOverview } from "../../timeline/overview";
import { createPaintScene, setMarker } from "../../timeline/scene";
import { recorderOf } from "../device-fixtures";
import { CONFIG } from "../helpers";
import { rowsOf, wireOf } from "../mission-fixtures";
import { PALETTE, recorder } from "../paint-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// timeline/overview.ts and hit.ts (spec 09 § M8 Overview scrubber): the
// viewport over the 2-minute buckets, the dimmed outside, and the drag.
// ─────────────────────────────────────────────────────────────────────────────

const LAYOUT = boxLayout(900, 40, 1);

/** The live end of the tests: two minutes after page-clock 10 s. */
const LIVE = 130_000;

/**
 * Mission control with two minutes of frames folded into the overview.
 *
 * @returns The mission state.
 */
function mission() {
  const { mission: state } = createRenderViewState({ config: CONFIG });
  appendFrames(state.history, wireOf(rowsOf(1, 7190, { t0: 10_000 })));
  noteRows(state.series, state.history, 0);
  return state;
}

describe("paintOverview", () => {
  it("the viewport rectangle spans the view; outside is dimmed", () => {
    // Bug: a viewport drawn at the live edge while the view is rewound 40 s.
    const scene = createPaintScene(PALETTE);
    scene.liveEndMs = LIVE;
    scene.endMs = LIVE - 40_000;
    scene.span = 6000;
    const { g, of } = recorder();

    paintOverview(g, LAYOUT, mission(), scene);

    const left = overviewX(LAYOUT, scene.endMs - 6000, LIVE);
    const right = overviewX(LAYOUT, scene.endMs, LIVE);
    const dims = of("fillRect").filter(call => call.fillStyle === "canvas" && call.alpha === 0.6);
    expect(dims.map(call => [call.args[0], call.args[2]])).toEqual([
      [0, left],
      [right, 900 - right]
    ]);
    const inside = of("fillRect").find(call => call.fillStyle === "accent" && call.alpha === 0.12);
    expect(inside?.args[0]).toBe(left);
    expect(inside?.args[2]).toBeCloseTo(right - left, 6);
  });

  it("says the history fills as frames arrive while it is empty", () => {
    // Bug: an empty dark strip with a viewport over nothing.
    const { mission: empty } = createRenderViewState({ config: CONFIG });
    const { g, texts } = recorder();

    paintOverview(g, LAYOUT, empty, createPaintScene(PALETTE));

    expect(texts()).toEqual(["The 2 min history fills as frames arrive"]);
  });
});

describe("overview drag", () => {
  it("a hit inside the viewport keeps the grab offset; outside it centres the viewport", () => {
    // Bug: the viewport jumps under the hand at the press (its end snapped to the pointer).
    const view = { endMs: 90_000, span: 6000, liveEndMs: LIVE };
    const inside = overviewX(LAYOUT, 88_000, LIVE);
    const outside = overviewX(LAYOUT, 50_000, LIVE);

    expect(grabOffset(LAYOUT, inside, view)).toBeCloseTo(2000, 6);
    expect(grabOffset(LAYOUT, outside, view)).toBe(3000);
    expect(overviewTime(LAYOUT, 0, LIVE)).toBe(LIVE - HISTORY_MS);
  });
});

describe("overview marks", () => {
  it("draws rested buckets in the edge colour, the recording stripe and 'before: {from}' left of a switch", () => {
    // Bug: the old source's part of the overview not named after a switch.
    const state = mission();
    const scene = createPaintScene(PALETTE);
    scene.liveEndMs = LIVE;
    scene.endMs = LIVE;
    state.series.overview.flags[3] = 1;
    state.recorder = {
      ...recorderOf({ sinceMs: 30_000 }),
      marks: [{ atMs: 1000, label: "a", auto: false }]
    };
    setMarker(
      scene,
      {
        at: 0,
        kind: "lost",
        label: "Galaxy A26 disconnected here · Local preview resumed",
        device: null
      },
      LIVE - 30_000,
      "Galaxy A26"
    );
    const { g, of, texts } = recorder();

    paintOverview(g, LAYOUT, state, scene);

    expect(of("fillRect").some(call => call.fillStyle === "edge" && call.alpha === 0.55)).toBe(
      true
    );
    expect(of("fillRect").some(call => call.fillStyle === "error" && call.args[3] === 2)).toBe(
      true
    );
    expect(texts()).toEqual(expect.arrayContaining(["−2 min", "before: Galaxy A26"]));
  });
});
