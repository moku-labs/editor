import { describe, expect, it } from "vitest";
import { createGraphState, rowAt, spikeAt } from "../../graph";
import { windowOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// graph/hit: the spike under a tap and the row under an x, from the layout of
// the last paint. Here the plot maps 1 ms to 1 px: px0 0, px1 1000, 0…1000 ms.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A painter state laid out 1 px per ms, with one flag box from 300 to 330 for row 3.
 *
 * @returns The state.
 */
function laidOut() {
  const state = createGraphState(16);
  Object.assign(state, {
    px0: 0,
    px1: 1000,
    py0: 26,
    py1: 182,
    flagBand: 24,
    startMs: 0,
    spanMs: 1000
  });
  state.flagRow[0] = 3;
  state.flagX0[0] = 300;
  state.flagX1[0] = 330;
  state.flagCount = 1;
  return state;
}

/** Rows at 0, 100, … 900 ms; rows 3 and 7 are spikes (bar centres at 350 and 750). */
const WINDOW = windowOf(
  Array.from({ length: 10 }, (_, index) => ({
    t: index * 100,
    causes: index === 3 || index === 7 ? 1 : 0
  }))
);

describe("spikeAt", () => {
  it("answers the row of a flag tapped within 4 px of its box", () => {
    const state = laidOut();
    expect([spikeAt(state, WINDOW, 296, 10), spikeAt(state, WINDOW, 334, 30)]).toEqual([3, 3]);
  });

  it("answers the spike whose bar centre is within 9 px, and -1 at 10 px", () => {
    const state = laidOut();
    expect(spikeAt(state, WINDOW, 759, 120)).toBe(7);
    expect(spikeAt(state, WINDOW, 760, 120)).toBe(-1);
    expect(spikeAt(state, WINDOW, 295, 10)).toBe(-1);
  });
});

describe("rowAt", () => {
  it("maps x to the row by time and clamps at both edges", () => {
    const state = laidOut();
    expect([rowAt(state, WINDOW, 0), rowAt(state, WINDOW, 450), rowAt(state, WINDOW, 999)]).toEqual(
      [0, 4, 9]
    );
    expect([rowAt(state, WINDOW, -50), rowAt(state, WINDOW, 5000)]).toEqual([0, 9]);
  });

  it("answers -1 for an empty window", () => {
    expect(rowAt(laidOut(), windowOf([]), 10)).toBe(-1);
  });
});
