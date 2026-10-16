// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is the recorder's "none" */
import { beforeEach, describe, expect, it } from "vitest";
import { runMark, runRecord } from "../../actions/record";
import { recorderOf } from "../device-fixtures";
import { type MissionCtx, missionCtx } from "../mission-ctx";

// ─────────────────────────────────────────────────────────────────────────────
// actions/record.ts (spec 09 § M7 Record): editor.record { on } / { mark };
// the page sends no origin.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;

beforeEach(() => {
  ctx = missionCtx();
});

describe("Record, Stop and Mark", () => {
  it("Record runs editor.record { on: true } and sends no by", async () => {
    // Bug: the page claiming an origin the hub stamps.
    const answer = runRecord(ctx, true, undefined);
    expect(ctx.runs.at(-1)).toMatchObject({ id: "editor.record" });
    expect(ctx.runs.at(-1)?.input).toEqual({ on: true });
    ctx.runs.at(-1)?.resolve({
      on: true,
      file: "perf-1.jsonl",
      startedBy: { by: "editor", name: null },
      marked: false
    });
    expect(await answer).toEqual({ ok: true, text: "Recording", file: "perf-1.jsonl" });
    expect(ctx.workspace.toast).not.toHaveBeenCalled();
    void runRecord(ctx, true, " boss ");
    expect(ctx.runs.at(-1)?.input).toEqual({ on: true, label: "boss" });
  });

  it("Mark runs editor.record { mark }; an empty label becomes 'mark {n+1}'", async () => {
    // Bug: unnamed marks all called "mark", or a mark sent with no label.
    ctx.state.mission.recorder = {
      ...recorderOf(),
      marks: [{ atMs: 1000, label: "boss intro", auto: false }]
    };
    const marked = runMark(ctx, "");
    expect(ctx.runs.at(-1)?.input).toEqual({ mark: "mark 2" });
    ctx.runs.at(-1)?.resolve({ on: true, file: "perf-1.jsonl", startedBy: null, marked: true });
    expect(await marked).toBe(true);
    const refused = runMark(ctx, "x");
    ctx.runs.at(-1)?.reject(new Error("[moku-editor] not recording"));
    expect(await refused).toBe(false);
  });

  it("Stop toasts the saved path; a refusal says why and toasts nothing", async () => {
    // Bug: the log saved without telling where.
    ctx.state.mission.recorder = { ...recorderOf({ bytes: 3_100_000 }), marks: [] };
    const stopped = runRecord(ctx, false, undefined);
    ctx.runs.at(-1)?.resolve({ on: false, file: "perf-1.jsonl", startedBy: null, marked: false });
    await stopped;
    expect(ctx.workspace.toast).toHaveBeenCalledWith(
      "Recording saved: .moku/perf/perf-1.jsonl, 3.1 MB"
    );

    const refused = runRecord(ctx, true, undefined);
    ctx.runs.at(-1)?.reject({ data: { reason: "dev_only" } });
    const refusedAnswer = await refused;
    expect(refusedAnswer.text).toBe("Refused: needs a debug build");
    expect(ctx.workspace.toast).toHaveBeenCalledTimes(1);
  });
});
