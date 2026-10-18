import { describe, expect, it } from "vitest";
import { noteEvents, noteRows } from "../../series/overview";
import { createMissionSeries, OVERVIEW_BUCKETS, OVERVIEW_FLAGS } from "../../series/series";
import { appendFrames, CAUSE_RANK, createPerfHistory, REST } from "../../source/contract";
import { bitsOf, historyOf, line, rowsOf, wireOf, withEvents } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// series/overview.ts (spec 09 § M11): the 2-minute overview's 500 ms buckets,
// folded from the rows each appendFrames added and the events each
// appendEvents added — never recomputed per paint.
// ─────────────────────────────────────────────────────────────────────────────

/** The cause code of a cause in the overview (CAUSE_RANK order + 1). */
function codeOf(cause: (typeof CAUSE_RANK)[number]): number {
  return CAUSE_RANK.indexOf(cause) + 1;
}

describe("noteRows", () => {
  it("a bucket keeps its worst frame, its spike cause, GC and rate flags", () => {
    // Bug: a spike tick lost in its bucket (only the last row's cause kept, or the max lost).
    const history = historyOf(
      rowsOf(100, 30, {
        t0: 10_000,
        each: index => {
          if (index === 3) return { ms: 41.3, causes: bitsOf("js") };
          if (index === 5) return { ms: 30, causes: bitsOf("upload", "js") };
          return { ms: 10 };
        }
      })
    );
    withEvents(history, [line.gc(10_100, 106, 4.2), line.rate(10_150, 109, 120, 60)]);
    const series = createMissionSeries();

    noteRows(series, history, 0);
    noteEvents(series, history, 0);

    const { overview } = series;
    expect(overview.start).toBe(10_000);
    expect(overview.max[0]).toBeCloseTo(41.3, 3);
    expect(overview.cause[0]).toBe(codeOf("upload"));
    expect((overview.flags[0] ?? 0) & OVERVIEW_FLAGS.spike).not.toBe(0);
    expect((overview.flags[0] ?? 0) & OVERVIEW_FLAGS.gc).not.toBe(0);
    expect((overview.flags[0] ?? 0) & OVERVIEW_FLAGS.rate).not.toBe(0);
    expect((overview.flags[0] ?? 0) & OVERVIEW_FLAGS.rested).toBe(0);
  });

  it("a bucket that only rested is marked rested; one awake frame clears it and sets the bar", () => {
    // Bug: a bucket with work drawn grey as "rest", or a 1 s rest row as the bucket's bar.
    const history = historyOf([
      { frame: 1, t: 10_000, ms: 33.3, rest: REST.idle },
      { frame: 2, t: 10_033, ms: 33.3, rest: REST.idle },
      { frame: 3, t: 10_600, ms: 400, rest: REST.idle },
      { frame: 4, t: 10_700, ms: 12, rest: REST.awake }
    ]);
    const series = createMissionSeries();

    noteRows(series, history, 0);

    const { overview } = series;
    expect((overview.flags[0] ?? 0) & OVERVIEW_FLAGS.rested).toBe(OVERVIEW_FLAGS.rested);
    expect((overview.flags[1] ?? 0) & OVERVIEW_FLAGS.rested).toBe(0);
    expect(overview.max[1]).toBe(12);
  });

  it("folds only the rows from `first`: an older spike is not ticked again after a clear", () => {
    // Bug: the overview recomputed from row 0 on every append (a cost per poll, and a source's
    // spike re-ticked after the overview was emptied).
    const history = createPerfHistory();
    appendFrames(
      history,
      wireOf(rowsOf(1, 10, { each: () => ({ ms: 50, causes: bitsOf("js") }) }))
    );
    const series = createMissionSeries();
    const before = history.count;
    appendFrames(history, wireOf(rowsOf(11, 10, { t0: 12_000 })));

    noteRows(series, history, before);

    expect(series.overview.cause[0]).toBe(0);
    expect(series.overview.start).toBe(12_000);
    expect(series.version).toBe(1);
  });

  it("scrolls old buckets out past two minutes and keeps the newest", () => {
    // Bug: buckets that never scroll: the overview stops at 2 min or writes past its arrays.
    const history = createPerfHistory();
    const series = createMissionSeries();
    appendFrames(
      history,
      wireOf(rowsOf(1, 2, { t0: 10_000, each: () => ({ ms: 50, causes: bitsOf("gpu") }) }))
    );
    noteRows(series, history, 0);
    const before = history.count;
    appendFrames(history, wireOf(rowsOf(3, 2, { t0: 10_000 + 130_000 })));

    noteRows(series, history, Math.min(before, history.count - 2));

    const { overview } = series;
    expect(overview.count).toBe(OVERVIEW_BUCKETS);
    expect(overview.start).toBe(140_000 - (OVERVIEW_BUCKETS - 1) * 500);
    expect(overview.cause.includes(codeOf("gpu"))).toBe(false);
    expect(overview.max[OVERVIEW_BUCKETS - 1]).toBe(10);
  });
});
