// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { beforeEach, describe, expect, it } from "vitest";
import { runRate } from "../../actions/rate";
import { checkedRate } from "../../derive/rate";
import { syncSource } from "../../source/sync";
import { DEVICE, secondOf } from "../device-fixtures";
import { type MissionCtx, missionCtx, settle } from "../mission-ctx";

// ─────────────────────────────────────────────────────────────────────────────
// actions/rate.ts (spec 09 § M9 Rate switch): game.frameRate on the active
// source, one in flight, late answers dropped.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;

beforeEach(() => {
  ctx = missionCtx();
});

describe("runRate", () => {
  it("setRate(120) runs game.frameRate { fps: 120 }, adaptive runs {}", async () => {
    // Bug: { fps: "adaptive" } sent to the engine.
    const pinned = runRate(ctx, 120);
    expect(ctx.runs.at(-1)).toMatchObject({ id: "game.frameRate", input: { fps: 120 } });
    expect(ctx.state.mission.rate.pending).toBe(120);
    ctx.runs.at(-1)?.resolve({
      fps: 120,
      mode: "forced",
      reason: "forced",
      displayHz: 120,
      asked: 120,
      heldBy: null
    });
    const pinnedAnswer = await pinned;
    expect(pinnedAnswer.text).toBe("Pinned at 120, adaptive off");
    expect(ctx.state.mission.rate).toMatchObject({
      pending: undefined,
      answer: { ok: true, fps: 120 }
    });

    const adaptive = runRate(ctx, "adaptive");
    expect(ctx.runs.at(-1)).toMatchObject({ id: "game.frameRate", input: {} });
    ctx.runs.at(-1)?.resolve({
      fps: 120,
      mode: "auto",
      reason: "start",
      displayHz: 120,
      asked: null,
      heldBy: null
    });
    const adaptiveAnswer = await adaptive;
    expect(adaptiveAnswer.ok).toBe(true);
  });

  it("a second setRate while pending resolves Busy without a second run", async () => {
    // Bug: two pins racing; the radio ends on whichever answered last.
    void runRate(ctx, 120);
    const second = await runRate(ctx, 60);
    expect(second).toEqual({ ok: false, choice: 60, text: "Busy: a rate change is still pending" });
    expect(ctx.runs).toHaveLength(1);
  });

  it("a cap in the answer keeps the previous choice", async () => {
    // Bug: the radio showing 120 while the device runs 60.
    ctx.state.mission.second = secondOf();
    const capped = runRate(ctx, 120);
    ctx.runs.at(-1)?.resolve({
      fps: 60,
      mode: "forced",
      reason: "forced",
      displayHz: 120,
      asked: 120,
      heldBy: null
    });
    const answer = await capped;
    expect(answer.ok).toBe(false);
    expect(checkedRate(ctx.state.mission.second, ctx.state.mission.rate.answer)).toBe("adaptive");
  });

  it("a refusal keeps its words; a late answer after a source switch is dropped", async () => {
    // Bug: the local preview's answer line shown on the phone after a switch.
    const refused = runRate(ctx, 120);
    ctx.runs.at(-1)?.reject({ data: { reason: "dev_only" } });
    const refusedAnswer = await refused;
    expect(refusedAnswer.text).toBe("Refused: needs a debug build");

    const late = runRate(ctx, 60);
    syncSource(
      ctx,
      {
        from: ctx.state.mission.source ?? { kind: "local", session: null },
        to: { kind: "device", session: "s-9", device: DEVICE },
        reason: "connected",
        at: 1
      },
      false
    );
    ctx.runs.at(-1)?.resolve({
      fps: 60,
      mode: "forced",
      reason: "forced",
      displayHz: 120,
      asked: 60,
      heldBy: null
    });
    await late;
    await settle();
    expect(ctx.state.mission.rate).toEqual({ pending: undefined, answer: undefined });
  });
});
