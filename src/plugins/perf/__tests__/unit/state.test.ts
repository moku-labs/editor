import { describe, expect, it } from "vitest";
import { notifyWatchers } from "../../state";
import { createLog, perfState } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// state: the watches every changed read and stream line notifies.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A state with a mock log and the given watchers.
 *
 * @param watchers - The watchers, in order.
 * @returns The state and the log.
 */
function withWatchers(...watchers: (() => void)[]) {
  const { state } = perfState();
  const log = createLog();
  state.log = log;
  for (const watcher of watchers) state.watchers.add(watcher);
  return { state, log };
}

/**
 * Throws, as a broken watch does.
 *
 * @throws {Error} Always.
 */
function failing(): void {
  throw new Error("watch broke");
}

describe("notifyWatchers", () => {
  it("still notifies the other watchers when one throws, and never throws itself (bug: one broken source watch silencing every other one)", () => {
    let calls = 0;
    const { state } = withWatchers(failing, () => {
      calls += 1;
    });
    expect(() => notifyWatchers(state)).not.toThrow();
    expect(calls).toBe(1);
  });

  it("warns perf:watcher-failed once per streak of failing rounds, and again after a clean round", () => {
    let broken = true;
    const { state, log } = withWatchers(() => {
      if (broken) failing();
    });
    notifyWatchers(state);
    notifyWatchers(state);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("perf:watcher-failed", { error: expect.any(Error) });
    broken = false;
    notifyWatchers(state);
    broken = true;
    notifyWatchers(state);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("drops the cached second", () => {
    const { state } = withWatchers();
    state.second = Object.freeze({}) as never;
    notifyWatchers(state);
    expect(state.second).toBeUndefined();
  });
});
