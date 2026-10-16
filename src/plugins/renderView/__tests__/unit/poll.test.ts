// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import { POLL_MS, pollOnce, startPoll, stopPoll } from "../../source/poll";
import { type MissionCtx, missionCtx, settle } from "../mission-ctx";
import { bitsOf, EPOCH, eventsOf, line, rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// source/poll.ts (spec 09 § M2 rule 2): the 1 s poll of editor.perf.frames and
// editor.perf.events into the history.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;

beforeEach(() => {
  vi.useFakeTimers();
  ctx = missionCtx();
});

afterEach(() => {
  stopPoll(ctx.state.mission);
  vi.useRealTimers();
});

/**
 * Answers the next read of a feed.
 *
 * @param id - The feed.
 * @param value - The answer.
 */
async function answer(id: string, value: unknown): Promise<void> {
  const read = ctx.reads.findLast(call => call.id === id && !Reflect.get(call, "answered"));
  if (read === undefined) throw new Error(`no read of ${id}`);
  Reflect.set(read, "answered", true);
  read.resolve(toWireValue(value));
  await settle();
}

describe("the poll", () => {
  it("reads frames with after = the newest frame, then events with after = next seq", async () => {
    // Bug: every frame of the agent's window sent again each second.
    void pollOnce(ctx);
    expect(ctx.reads.map(read => [read.id, read.input])).toEqual([["editor.perf.frames", {}]]);
    await answer("editor.perf.frames", wireOf(rowsOf(1, 60, { t0: 10_000 })));
    expect(ctx.reads.at(-1)).toMatchObject({ id: "editor.perf.events", input: {} });
    await answer("editor.perf.events", eventsOf([line.gc(10_100, 6, 4)], 812));

    void pollOnce(ctx);
    expect(ctx.reads.at(-1)).toMatchObject({ id: "editor.perf.frames", input: { after: 60 } });
    await answer("editor.perf.frames", wireOf(rowsOf(61, 60, { t0: 11_000 })));
    expect(ctx.reads.at(-1)).toMatchObject({ id: "editor.perf.events", input: { after: 813 } });
    await answer("editor.perf.events", eventsOf([], 813));

    expect(ctx.state.mission.history.count).toBe(120);
    expect(ctx.state.mission.poll.eventsAfter).toBe(813);
  });

  it("a read in flight is not doubled by the next tick", async () => {
    // Bug: two frames reads in flight append the same rows twice and double the wire.
    startPoll(ctx);
    expect(ctx.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(ctx.reads).toHaveLength(1);
    await answer("editor.perf.frames", wireOf(rowsOf(1, 10)));
    await answer("editor.perf.events", eventsOf([]));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(ctx.reads.filter(read => read.id === "editor.perf.frames")).toHaveLength(2);
  });

  it("a failed read retries on the next tick and logs once per streak", async () => {
    // Bug: a debug line every second while the phone sleeps, or no retry after one failure.
    startPoll(ctx);
    ctx.reads[0]?.reject(new Error("[moku-editor] timeout"));
    await settle();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    ctx.reads[1]?.reject(new Error("[moku-editor] timeout"));
    await settle();
    expect(ctx.reads.filter(read => read.id === "editor.perf.frames")).toHaveLength(2);
    expect(ctx.log.debug).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    await answer("editor.perf.frames", wireOf(rowsOf(1, 10)));
    await answer("editor.perf.events", eventsOf([]));
    expect(ctx.state.mission.poll.failing).toBe(false);
  });

  it("a new epoch resets the history and the series", async () => {
    // Bug: a reloaded page's frames glued to the old ones.
    const { mission } = ctx.state;
    void pollOnce(ctx);
    await answer(
      "editor.perf.frames",
      wireOf(rowsOf(1, 60, { t0: 10_000, each: () => ({ causes: bitsOf("js"), ms: 30 }) }))
    );
    await answer("editor.perf.events", eventsOf([]));
    mission.selection = { from: 5, to: 6 };

    void pollOnce(ctx);
    await answer("editor.perf.frames", wireOf(rowsOf(1, 10, { t0: 500 }), { epoch: `${EPOCH}9` }));

    expect(mission.history.count).toBe(10);
    expect(mission.history.frame[0]).toBe(1);
    expect(
      mission.series.overview.cause
        .slice(0, mission.series.overview.count)
        .every(code => code === 0)
    ).toBe(true);
    expect(mission.selection).toBeUndefined();
  });

  it("each frames answer with new rows feeds the display clock", async () => {
    // Bug: the playout clock never started (no motion), or fed by empty answers (a stall drifts on).
    const { clock } = ctx.state.mission;
    void pollOnce(ctx);
    await answer("editor.perf.frames", wireOf([]));
    await answer("editor.perf.events", eventsOf([]));
    expect(clock.endMs).toBeUndefined();
    void pollOnce(ctx);
    await answer("editor.perf.frames", wireOf(rowsOf(1, 2, { t0: 10_000 })));
    expect(clock.endMs).toBeCloseTo(10_026.67, 2);
  });

  it("Render hidden stops the poll; showing it again resumes from the newest frame", async () => {
    // Bug: a poll that keeps reading a hidden workspace, or starts over from frame 0.
    startPoll(ctx);
    await answer("editor.perf.frames", wireOf(rowsOf(1, 30)));
    await answer("editor.perf.events", eventsOf([]));
    stopPoll(ctx.state.mission);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(ctx.reads.filter(read => read.id === "editor.perf.frames")).toHaveLength(1);

    startPoll(ctx);
    expect(ctx.reads.at(-1)).toMatchObject({ id: "editor.perf.frames", input: { after: 30 } });
  });

  it("an answer that comes after the poll stopped is dropped; a feed not listed is not read", async () => {
    // Bug: a hidden Render's late answer appended after a source switch.
    startPoll(ctx);
    stopPoll(ctx.state.mission);
    await answer("editor.perf.frames", wireOf(rowsOf(1, 30)));
    expect(ctx.state.mission.history.count).toBe(0);

    const older = missionCtx({ sources: ["editor.perf.second"] });
    await pollOnce(older);
    expect(older.reads).toEqual([]);
  });
});

describe("broken answers", () => {
  it("a frames or events answer of another shape is dropped and warned", async () => {
    // Bug: a broken answer appended as rows of zeros.
    void pollOnce(ctx);
    await answer("editor.perf.frames", { v: 1 });
    expect(ctx.state.mission.history.count).toBe(0);
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "editor.perf.frames"
    });
    await answer("editor.perf.events", { v: 1, items: "no" });
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "editor.perf.events"
    });
  });
});
