// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is perf's "none" in a detail answer */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import { cancelDetail, DETAIL_DELAY_MS, readDetail } from "../../actions/detail";
import { appendFrames } from "../../source/contract";
import { MISSION_SOURCES, type MissionCtx, missionCtx, settle } from "../mission-ctx";
import { rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// actions/detail.ts (spec 09 § M10 The detail read): one editor.perf.detail read
// 150 ms after a selection settles.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;

beforeEach(() => {
  vi.useFakeTimers();
  ctx = missionCtx();
  appendFrames(ctx.state.mission.history, wireOf(rowsOf(4800, 100, { t0: 10_000 })));
});

afterEach(() => {
  cancelDetail(ctx.state.mission);
  vi.useRealTimers();
});

/**
 * Selects a range and asks its detail, as the api does.
 *
 * @param from - The first frame.
 * @param to - The last frame.
 * @returns The range.
 */
function select(from: number, to: number) {
  const range = { from, to };
  ctx.state.mission.selection = range;
  readDetail(ctx, range);
  return range;
}

describe("the detail read", () => {
  it("a drag reads editor.perf.detail once, 150 ms after it settles", async () => {
    // Bug: a read per pointer move while dragging.
    select(4810, 4820);
    select(4810, 4840);
    select(4810, 4860);
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS - 1);
    expect(ctx.reads).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.reads.map(read => [read.id, read.input])).toEqual([
      ["editor.perf.detail", { from: 4810, to: 4860 }]
    ]);
    expect(ctx.state.mission.detail).toMatchObject({ kind: "loading" });
  });

  it("its frames are merged with appendFrames and its nodes kept for that range", async () => {
    // Bug: the engine's nodes of the range dropped, or kept for another range.
    const range = select(4810, 4860);
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS);
    const nodes = [{ entity: 1, label: "fogLayer", how: "redraw", count: 20 }];
    ctx.reads[0]?.resolve(
      toWireValue({
        v: 1,
        from: 4810,
        to: 4860,
        source: "engine",
        reason: null,
        frames: wireOf(rowsOf(4900, 5, { t0: 12_000 })),
        nodes
      })
    );
    await settle();
    expect(ctx.state.mission.detail).toEqual({ kind: "shown", range, reason: null, nodes });
    expect(ctx.state.mission.history.frame[ctx.state.mission.history.count - 1]).toBe(4904);
  });

  it("a late answer for a replaced selection is dropped", async () => {
    // Bug: the nodes of the old range shown under the new one.
    select(4810, 4860);
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS);
    const next = select(4870, 4880);
    ctx.reads[0]?.resolve(
      toWireValue({
        v: 1,
        from: 4810,
        to: 4860,
        source: "agent",
        reason: "no-detail",
        frames: null,
        nodes: null
      })
    );
    await settle();
    expect(ctx.state.mission.detail).toEqual({ kind: "loading", range: next });
  });

  it("reason gone keeps the history view with its reason; a failed read says so", async () => {
    // Bug: an empty range view when the phone no longer holds the frames.
    const range = select(4810, 4860);
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS);
    ctx.reads[0]?.resolve(
      toWireValue({
        v: 1,
        from: 4810,
        to: 4860,
        source: null,
        reason: "gone",
        frames: null,
        nodes: null
      })
    );
    await settle();
    expect(ctx.state.mission.detail).toEqual({ kind: "shown", range, reason: "gone", nodes: null });
    expect(ctx.state.mission.history.count).toBe(100);

    const failed = select(4820, 4830);
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS);
    ctx.reads[1]?.reject(new Error("[moku-editor] timeout"));
    await settle();
    expect(ctx.state.mission.detail).toEqual({ kind: "failed", range: failed, message: "timeout" });
  });

  it("a source without editor.perf.detail sends no read", async () => {
    // Bug: an older agent asked for a feed it does not have.
    ctx = missionCtx({ sources: MISSION_SOURCES.filter(id => id !== "editor.perf.detail") });
    select(4810, 4860);
    await vi.advanceTimersByTimeAsync(DETAIL_DELAY_MS * 2);
    expect(ctx.reads).toEqual([]);
    expect(ctx.state.mission.detail).toEqual({ kind: "idle" });
  });
});
