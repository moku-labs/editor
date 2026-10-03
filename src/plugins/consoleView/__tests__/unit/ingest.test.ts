import { describe, expect, it } from "vitest";
import { ingestTrace, pushLine } from "../../ingest";
import { createConsoleState } from "../../state";
import type { EntryLine, TraceEntry } from "../../types";
import { CONFIG, entryLine, TRACE, traceValue } from "../helpers";

const RELOADED = "Log cleared: the game page reloaded. Turn on Preserve log to keep it.";
const PRESERVED = "Game page reloaded · log preserved";

function fresh() {
  return createConsoleState({ config: CONFIG });
}

function entries(state: ReturnType<typeof fresh>): EntryLine[] {
  return state.lines.filter((line): line is EntryLine => line.kind === "entry");
}

const NEXT_GAME: readonly TraceEntry[] = [
  { level: "info", event: "flow: enter main/boot", ts: 9000 },
  { level: "info", event: "assets: bundle loaded", ts: 9010 }
];

describe("ingestTrace", () => {
  it("takes every entry on the first ingest, 'at or before' the arrival frame", () => {
    const state = fresh();
    const result = ingestTrace(state, traceValue(), 1840, CONFIG);

    expect(result).toEqual({ changed: true });
    expect(state.lines).toHaveLength(8);
    expect(state.consumed).toBe(8);
    expect(state.nextKey).toBe(9);
    expect(state.instance).toEqual({ ts: 1000, event: "flow: enter main/boot" });
    expect(entries(state)[0]?.frame).toEqual({ value: 1840, exact: false });
    expect(entries(state).map(line => line.key)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("uses data.frame as the exact frame", () => {
    const state = fresh();
    ingestTrace(state, traceValue(), 1840, CONFIG);
    expect(entries(state)[7]?.frame).toEqual({ value: 1778, exact: true });
    expect(entries(state)[3]?.frame).toEqual({ value: 212, exact: true });
  });

  it("takes only the new entries on the next ingest", () => {
    const state = fresh();
    ingestTrace(state, traceValue(TRACE.slice(0, 5)), 100, CONFIG);
    const result = ingestTrace(state, traceValue(), 200, CONFIG);

    expect(result).toEqual({ changed: true });
    expect(state.lines).toHaveLength(8);
    expect(entries(state)[5]?.frame).toEqual({ value: 1503, exact: true });
    expect(entries(state)[6]?.frame).toEqual({ value: 200, exact: false });
    expect(entries(state)[0]?.frame).toEqual({ value: 100, exact: false });
  });

  it("is idempotent for the same value", () => {
    const state = fresh();
    ingestTrace(state, traceValue(), 1840, CONFIG);
    expect(ingestTrace(state, traceValue(), 1841, CONFIG)).toEqual({ changed: false });
    expect(state.lines).toHaveLength(8);
  });

  it("treats a trace shorter than consumed as a reload (preserve off: clears + meta)", () => {
    const state = fresh();
    ingestTrace(state, traceValue(), 1840, CONFIG);
    state.selected = 3;
    const result = ingestTrace(state, traceValue(TRACE.slice(0, 2)), 5, CONFIG);

    expect(result).toEqual({ changed: true });
    expect(state.lines[0]).toMatchObject({ kind: "meta", text: RELOADED });
    expect(entries(state)).toHaveLength(2);
    expect(state.consumed).toBe(2);
    expect(state.selected).toBeUndefined();
  });

  it("treats a different first entry as a reload", () => {
    const state = fresh();
    ingestTrace(state, traceValue(), 1840, CONFIG);
    ingestTrace(state, traceValue(NEXT_GAME), 3, CONFIG);

    expect(state.lines.map(line => (line.kind === "meta" ? line.text : line.message))).toEqual([
      RELOADED,
      "enter main/boot",
      "bundle loaded"
    ]);
    expect(state.instance).toEqual({ ts: 9000, event: "flow: enter main/boot" });
  });

  it("detects a first entry with the same ts but another event", () => {
    const state = fresh();
    ingestTrace(state, traceValue(TRACE.slice(0, 1)), 1, CONFIG);
    ingestTrace(state, traceValue([{ level: "info", event: "other", ts: 1000 }]), 1, CONFIG);
    expect(state.lines[0]).toMatchObject({ kind: "meta", text: RELOADED });
  });

  it("keeps the lines and adds a meta row when Preserve log is on", () => {
    const state = fresh();
    state.preserve = true;
    ingestTrace(state, traceValue(), 1840, CONFIG);
    ingestTrace(state, traceValue(NEXT_GAME), 3, CONFIG);

    expect(state.lines).toHaveLength(11);
    expect(state.lines[8]).toMatchObject({ kind: "meta", key: 9, text: PRESERVED });
    expect(state.lines[9]).toMatchObject({ kind: "entry", key: 10, ts: 9000 });
  });

  it("an empty trace after entries is a reload with instance undefined", () => {
    const state = fresh();
    ingestTrace(state, traceValue(), 1840, CONFIG);
    const result = ingestTrace(state, [], 3, CONFIG);

    expect(result).toEqual({ changed: true });
    expect(state.instance).toBeUndefined();
    expect(state.consumed).toBe(0);
    expect(state.lines).toEqual([expect.objectContaining({ kind: "meta", text: RELOADED })]);

    // The next game's first value is taken whole, with no second meta row.
    ingestTrace(state, traceValue(NEXT_GAME), 4, CONFIG);
    expect(state.lines).toHaveLength(3);
  });

  it("an empty first trace changes nothing", () => {
    const state = fresh();
    expect(ingestTrace(state, [], 1, CONFIG)).toEqual({ changed: false });
    expect(state.lines).toEqual([]);
  });

  it("trims the oldest lines above maxLines", () => {
    const state = fresh();
    ingestTrace(state, traceValue(), 1840, { ...CONFIG, maxLines: 3 });
    expect(state.lines.map(line => line.key)).toEqual([6, 7, 8]);
  });

  it("refuses a value that is not an array", () => {
    const state = fresh();
    expect(ingestTrace(state, { entries: [] }, 1, CONFIG)).toEqual({
      changed: false,
      invalid: true
    });
    expect(state.lines).toEqual([]);
  });

  it("skips items that are not trace entries one by one", () => {
    const state = fresh();
    ingestTrace(state, [{ level: "info", event: "a", ts: 1 }, "junk", { level: "x" }], 1, CONFIG);
    expect(state.lines).toHaveLength(1);
    expect(state.consumed).toBe(3);
  });

  it("an invalid first item counts as a missing first entry", () => {
    const state = fresh();
    ingestTrace(state, traceValue(TRACE.slice(0, 2)), 1, CONFIG);
    ingestTrace(
      state,
      ["junk", { level: "info", event: "b", ts: 5 }, { level: "info", event: "c", ts: 6 }],
      1,
      CONFIG
    );
    expect(state.lines[0]).toMatchObject({ kind: "meta", text: RELOADED });
    expect(state.instance).toBeUndefined();
  });
});

describe("pushLine", () => {
  it("appends and trims to maxLines", () => {
    const state = fresh();
    state.lines = [entryLine(1), entryLine(2)];
    pushLine(state, entryLine(3), 2);
    expect(state.lines.map(line => line.key)).toEqual([2, 3]);
  });
});
