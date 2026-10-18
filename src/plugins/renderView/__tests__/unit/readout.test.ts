/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import { describe, expect, it } from "vitest";
import { readoutOf } from "../../derive/cards";
import { pushSample } from "../../series/series";
import { appendFrames } from "../../source/contract";
import { createRenderViewState } from "../../state";
import { CONFIG } from "../helpers";
import { ENGINE_REST, rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/cards.ts readoutOf (spec 09 § M9 "a cursor readout chip … while
// hovering"): each card reads its own measure at the hovered frame, from the
// history or the side series at that frame's time, a series sample held for at
// most 2 s; no value, no chip (never 0).
// ─────────────────────────────────────────────────────────────────────────────

function missionWithFrames() {
  const { mission } = createRenderViewState({ config: CONFIG });
  appendFrames(
    mission.history,
    wireOf(
      rowsOf(4850, 3, {
        t0: 10_000,
        each: index => ({ ms: 16.2 + index, draws: index === 2 ? null : 212 })
      }),
      { draws: true }
    )
  );
  return mission;
}

describe("the cards' cursor chips", () => {
  it("each card reads its own measure at the hovered frame", () => {
    const mission = missionWithFrames();
    pushSample(mission.series.heap, 9000, 40.5);
    pushSample(mission.series.heap, 10_010, 41.25);

    expect(readoutOf("frame", mission, 4851)).toBe("f4851 17.2 ms");
    expect(readoutOf("fps", mission, 4851)).toBe("f4851 60 fps");
    expect(readoutOf("draws", mission, 4851)).toBe("f4851 212");
    expect(readoutOf("memory", mission, 4851)).toBe("f4851 41.3 MB");
  });

  it("the FPS chip over a real engine's resting frame reads the rest rate, 30 fps, not the loop's 60", () => {
    // Bug: "f4851 60 fps" over a rest: rateMs stays the loop's 16.67 ms beside a 33.3 ms rest budget.
    const { mission } = createRenderViewState({ config: CONFIG });
    appendFrames(mission.history, wireOf(rowsOf(4850, 3, { t0: 10_000, each: () => ENGINE_REST })));

    expect(readoutOf("fps", mission, 4851)).toBe("f4851 30 fps");
  });

  it("shows no chip where the measure has no value, never a 0", () => {
    const mission = missionWithFrames();

    expect(readoutOf("draws", mission, 4852)).toBeUndefined();
    expect(readoutOf("memory", mission, 4851)).toBeUndefined();
    expect(readoutOf("frame", mission, 4999)).toBeUndefined();
  });

  it("holds a series sample for 2 s before the hovered frame, not longer", () => {
    const stale = missionWithFrames();
    pushSample(stale.series.heap, 7000, 39.5);
    expect(readoutOf("memory", stale, 4851)).toBeUndefined();

    const held = missionWithFrames();
    pushSample(held.series.heap, 8500, 40.5);
    expect(readoutOf("memory", held, 4851)).toBe("f4851 40.5 MB");
  });
});
