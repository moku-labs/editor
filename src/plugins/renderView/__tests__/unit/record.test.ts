/* eslint-disable unicorn/no-null -- null is the recorder's "none" */
import { describe, expect, it } from "vitest";
import { wireError } from "../../../registry/protocol";
import {
  logPath,
  markLabelOf,
  marksRows,
  pillBy,
  recordAnswerOf,
  recordingView,
  recordPill,
  recordRefusalOf,
  savedText,
  startedText,
  whoText
} from "../../derive/record";
import type { RecorderSource } from "../../source/contract";
import { recorderOf } from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/record.ts (spec 09 § M5, M7 Record; spec 05 R2): who started the log,
// the pill, the path and the marks.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A recorder source with marks.
 *
 * @param overrides - Field overrides.
 * @returns The source.
 */
function sourceOf(overrides: Partial<RecorderSource> = {}): RecorderSource {
  return { ...recorderOf(), marks: [], ...overrides };
}

describe("who started it", () => {
  it("names the agent with its name, without 'null'; yours as 'you'; the phone, remote, code and launch", () => {
    // Bug: the agent's log labelled as yours, or a name shown as "agent (null)".
    expect(pillBy({ by: "agent", name: "Claude" })).toBe("by agent (Claude)");
    expect(startedText({ by: "agent", name: "Claude" })).toBe("started by agent (Claude)");
    expect(whoText({ by: "agent", name: null })).toBe("agent");
    expect(startedText({ by: "agent", name: null })).toBe("started by agent");
    expect(pillBy({ by: "editor", name: null })).toBe("by you");
    expect(startedText({ by: "editor", name: null })).toBe("started by you");
    expect(whoText({ by: "phone", name: null })).toBe("you (on the phone)");
    expect(startedText({ by: "phone", name: null })).toBe("started on the phone");
    expect(whoText({ by: "remote", name: null })).toBe("the editor or an agent");
    expect(whoText({ by: "code", name: null })).toBe("the game");
    expect(startedText({ by: "auto", name: null })).toBe("started on launch");
    expect(pillBy(null)).toBe("");
  });
});

describe("the log", () => {
  it("the path is '.moku/perf/<file>'; Stop's toast names it with its size", () => {
    // Bug: a computer path invented the recorder never sent.
    expect(logPath("perf-20261016-1412-sm-a266b.jsonl")).toBe(
      ".moku/perf/perf-20261016-1412-sm-a266b.jsonl"
    );
    expect(logPath(null)).toBe("");
    expect(savedText("perf-1.jsonl", 3_100_000)).toBe(
      "Recording saved: .moku/perf/perf-1.jsonl, 3.1 MB"
    );
  });

  it("elapsed is the recorder's sinceMs, not the tools clock", () => {
    // Bug: the elapsed time of the page, not of the log on the phone.
    expect(
      recordPill(
        sourceOf({ sinceMs: 42_500, bytes: 3_100_000, startedBy: { by: "agent", name: "Claude" } })
      )
    ).toEqual({
      elapsed: "00:42",
      size: "3.1 MB",
      by: "by agent (Claude)"
    });
  });

  it("marks newest last with mm:ss; an empty mark label becomes 'mark {n + 1}'", () => {
    // Bug: two marks both called "mark", or the newest listed first.
    const marks = [
      { atMs: 31_000, label: "fog on", auto: false },
      { atMs: 20_000, label: "boss intro", auto: false }
    ];
    expect(marksRows(marks)).toEqual([
      { label: "boss intro", at: "00:20" },
      { label: "fog on", at: "00:31" }
    ]);
    expect(markLabelOf("  ", marks)).toBe("mark 3");
    expect(markLabelOf(undefined, [])).toBe("mark 1");
    expect(markLabelOf(" boss ", marks)).toBe("boss");
  });

  it("the view copies the marks and keeps who started it", () => {
    // Bug: the MCP view sharing the recorder's live array.
    const source = sourceOf({ marks: [{ atMs: 1000, label: "a", auto: false }] });
    const view = recordingView(source);
    expect(view?.startedBy).toEqual({ by: "editor", name: null });
    expect(view?.marks).not.toBe(source.marks);
    expect(recordingView(undefined)).toBeUndefined();
  });
});

describe("answers", () => {
  it("Record and Stop answers keep the file; a refusal says why", () => {
    // Bug: a refused Record shown as recording.
    expect(
      recordAnswerOf(true, { on: true, file: "perf-1.jsonl", startedBy: null, marked: false })
    ).toEqual({
      ok: true,
      text: "Recording",
      file: "perf-1.jsonl"
    });
    expect(
      recordAnswerOf(false, { on: false, file: null, startedBy: null, marked: false }).text
    ).toBe("Stopped");
    expect(recordAnswerOf(true, "nope").ok).toBe(false);
    expect(recordRefusalOf(wireError(-32_009, "x", { reason: "dev_only" })).text).toBe(
      "Refused: needs a debug build"
    );
    expect(recordRefusalOf(wireError(-32_003, "x", { reason: "no_session" })).text).toBe(
      "Not sent: no source connected"
    );
    expect(
      recordRefusalOf(new Error("[moku-editor] perf has no monitor.\n  Run a game.")).text
    ).toBe("Refused: perf has no monitor.");
  });
});
