/* eslint-disable unicorn/no-null -- null is the header's "no value" */
import { describe, expect, it } from "vitest";
import { spikeGroupAt, spikeGroups } from "../../series/groups";
import { createMissionSeries, pushSample } from "../../series/series";
import { viewStats } from "../../series/stats";
import { REST } from "../../source/contract";
import { bitsOf, historyOf, line, rowsOf, withEvents } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// series/stats.ts and series/groups.ts (spec 09 § M8 frames header, § M11): the
// numbers of the frames in view, and spike groups — consecutive frames of one
// primary cause.
// ─────────────────────────────────────────────────────────────────────────────

describe("viewStats", () => {
  it("p90 counts awake frames only", () => {
    // Bug: a 1 s resting frame read as the p90 of a calm view.
    const history = historyOf([
      ...rowsOf(1, 10, { t0: 10_000, each: index => ({ ms: index === 9 ? 20 : 10 }) }),
      ...rowsOf(11, 10, { t0: 10_200, stepMs: 1000, each: () => ({ ms: 1000, rest: REST.idle }) })
    ]);

    const stats = viewStats(history, 9000, 21_000);

    expect(stats.p90Ms).toBe(10);
    expect(stats.frames).toBe(20);
  });

  it("spikes in view count groups, not frames", () => {
    // Bug: "GPU ×3" counted as three spikes in the header.
    const history = historyOf(
      rowsOf(1, 20, {
        each: index => {
          if (index >= 4 && index <= 6) return { ms: 30, causes: bitsOf("gpu") };
          if (index === 12) return { ms: 41.3, causes: bitsOf("js") };
          return {};
        }
      })
    );

    const stats = viewStats(history, 0, 20_000);

    expect(stats.spikes).toBe(2);
    expect(stats.worstMs).toBe(41.3);
  });

  it("rest ms is clipped to the view", () => {
    // Bug: a rest that began before the view counted whole ("rest 3 s" in a 6 s view of 0.5 s).
    const history = historyOf([
      { frame: 1, t: 9500, ms: 1000, rest: REST.idle },
      { frame: 2, t: 10_500, ms: 10 }
    ]);

    const stats = viewStats(history, 10_000, 16_000);

    expect(stats.restMs).toBe(500);
    expect(stats.worstMs).toBeNull();
  });

  it("counts the GCs in view by time; an empty view reads nulls, never zeros", () => {
    // Bug: "p90 0 ms" and "worst 0 ms" shown for a view with no frames.
    const history = withEvents(historyOf(rowsOf(1, 10)), [
      line.gc(10_050, 4, 4.2),
      line.gc(30_000, null, 1)
    ]);

    expect(viewStats(history, 10_000, 11_000).gcs).toBe(1);
    // A wired phone's GCs (CDP, inferred) count too; one the engine also reported counts once.
    // Bug on the A26: "0 GC" while the heap sawed and the Memory card drew its GC diamonds.
    const gcs = createMissionSeries().gcs;
    pushSample(gcs, 10_060, 4.2); // the engine's GC at 10 050, seen over CDP too: counted once
    pushSample(gcs, 10_600, 3.1);
    expect(viewStats(history, 10_000, 11_000, gcs).gcs).toBe(2);
    expect(viewStats(history, 50_000, 56_000)).toEqual({
      frames: 0,
      spikes: 0,
      worstMs: null,
      p90Ms: null,
      restMs: 0,
      gcs: 0
    });
  });
});

describe("spike groups", () => {
  const history = historyOf(
    rowsOf(4850, 10, {
      each: index => {
        if (index >= 1 && index <= 3) return { ms: 30, causes: bitsOf("compile", "js") };
        if (index === 4) return { ms: 25, causes: bitsOf("js") };
        if (index === 7) return { ms: 22, causes: bitsOf("js") };
        return {};
      }
    })
  );

  it("consecutive frames of one cause form one group, a different cause starts a new one", () => {
    // Bug: a compile burst and the JS frame after it merged into one flag (one cause shown).
    const groups = spikeGroups(history, 0, history.count - 1);

    expect(groups.map(group => [group.from, group.to, group.cause])).toEqual([
      [4851, 4853, "compile"],
      [4854, 4854, "js"],
      [4857, 4857, "js"]
    ]);
    expect(groups[0]?.maxMs).toBe(30);
  });

  it("a group selects all its frames from any of its rows; a calm row has none", () => {
    // Bug: clicking the middle of "GPU ×3" selects one frame only.
    expect(spikeGroupAt(history, 2)).toMatchObject({ from: 4851, to: 4853 });
    expect(spikeGroupAt(history, 0)).toBeUndefined();
  });
});
