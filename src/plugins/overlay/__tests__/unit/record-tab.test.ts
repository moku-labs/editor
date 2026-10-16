/* eslint-disable unicorn/no-null -- null is the recorder's "no origin" and "no name" (RecordOrigin) */
import { describe, expect, it } from "vitest";
import type { RecordOrigin } from "../../../recorder/types";
import { clockText, groupDigits, sizeText } from "../../model/format";
import { recordTabView } from "../../model/record-tab";
import type { LinkPayload } from "../../types";
import { IDLE, logFile, RECORDING } from "../helpers";

const adb: LinkPayload = {
  status: { kind: "live", frame: 1 },
  link: { mode: "adb", address: "127.0.0.1:47600" }
};
const offline: LinkPayload = {
  status: { kind: "lost", reason: "x", lastFrame: 1, retryInMs: 1000 },
  link: { mode: "none", address: "127.0.0.1:47600" }
};

/**
 * The record tab view with the defaults of a linked phone.
 *
 * @param extra - Inputs to replace.
 * @returns The view.
 */
function view(extra: Partial<Parameters<typeof recordTabView>[0]> = {}) {
  return recordTabView({
    status: RECORDING,
    marks: [],
    files: [],
    payload: adb,
    hasBridge: true,
    draft: "",
    toast: undefined,
    ...extra
  });
}

/**
 * The origin line of a recording log.
 *
 * @param startedBy - Who started it.
 * @returns The line.
 */
function originOf(startedBy: RecordOrigin | null): string | undefined {
  return view({ status: { ...RECORDING, startedBy } }).origin;
}

describe("format", () => {
  it("1840 prints without grouping (it groups with a no-break space)", () => {
    expect(groupDigits(1840)).toBe("1 840");
    expect(groupDigits(1_234_567)).toBe("1 234 567");
    expect(groupDigits(50)).toBe("50");
  });

  it("192 000 ms of recording prints 3:12 instead of 03:12", () => {
    expect(clockText(192_000)).toBe("03:12");
    expect(clockText(3_723_000)).toBe("1:02:03");
    expect(clockText(0)).toBe("00:00");
  });

  it("prints sizes in KB under 1 MB, else MB", () => {
    expect(sizeText(412_000)).toBe("412 KB");
    expect(sizeText(2_100_000)).toBe("2.1 MB");
  });
});

describe("recordTabView", () => {
  it("reads REC, the clock, lines and size while recording", () => {
    const tab = view();
    expect(tab).toMatchObject({ recording: true, clock: "03:12", dim: false });
    expect(tab.legend).toMatchObject({ text: "REC", lit: true });
    expect(tab.stats).toEqual([
      { value: "1 840", text: " lines" },
      { value: "412", text: " KB" }
    ]);
    expect(tab.key).toEqual({ action: "stop", label: "Stop", disabled: false, title: undefined });
  });

  it("an idle recorder reads STOPPED, as if a log ran by itself (it reads OFF: nothing is saved until you record); a dim clock; Start is off without a monitor", () => {
    const tab = view({ status: { ...IDLE, monitor: false } });
    expect(tab).toMatchObject({ recording: false, clock: "00:00", dim: true, origin: undefined });
    expect(tab.legend).toMatchObject({ text: "OFF", lit: false, hollow: false });
    expect(tab.stats).toEqual([
      { value: "", text: "Nothing is saved until you record." },
      { value: "", text: "The editor or an agent can start it too." }
    ]);
    // An origin left on an idle status (a recorder keeping the last log's) is not shown.
    expect(
      view({ status: { ...IDLE, startedBy: { by: "agent", name: "Claude" } } }).origin
    ).toBeUndefined();
    expect(tab.key).toEqual({
      action: "start",
      label: "Start",
      disabled: true,
      title: "No frame monitor in this build"
    });
  });

  it("an agent's recording shows no hint where it came from, or agent (null) (the origin line names who started it)", () => {
    expect(originOf({ by: "agent", name: "Claude" })).toBe("started by an agent (Claude)");
    expect(originOf({ by: "agent", name: null })).toBe("started by an agent");
    expect(originOf({ by: "agent", name: "" })).toBe("started by an agent");
    expect(originOf({ by: "phone", name: null })).toBe("started here");
    expect(originOf({ by: "editor", name: "Claude" })).toBe("started from the editor");
    // No origin on the status: the numbers alone.
    expect(originOf(null)).toBeUndefined();
  });

  it("a long client name pushes the origin line off the row (it is cut to 12 characters with an ellipsis)", () => {
    expect(originOf({ by: "agent", name: "Claude Code" })).toBe(
      "started by an agent (Claude Code)"
    );
    expect(originOf({ by: "agent", name: "Claude Code!" })).toBe(
      "started by an agent (Claude Code!)"
    );
    expect(originOf({ by: "agent", name: "Claude Code!!" })).toBe(
      "started by an agent (Claude Code…)"
    );
  });

  it("disables the key while exporting", () => {
    expect(view({ status: { ...RECORDING, state: "exporting" } }).key.disabled).toBe(true);
  });

  it("the meter divides by zero with nothing sent", () => {
    expect(view({ status: { ...RECORDING, sent: 0, pending: 0 } }).sent).toEqual({
      linked: true,
      sent: "0",
      pending: "0",
      share: 0
    });
    expect(view().sent).toEqual({ linked: true, sent: "1 790", pending: "50", share: 1790 / 1840 });
    expect(view({ payload: offline }).sent).toEqual({
      linked: false,
      sent: "1 790",
      pending: "50",
      share: 0
    });
  });

  it("the sent line shows in page mode (it is left out, also without a bridge)", () => {
    expect(view({ payload: { status: { kind: "live", frame: 1 } } }).sent).toBeUndefined();
    expect(view({ hasBridge: false }).sent).toBeUndefined();
  });

  it("Delete is enabled on the current log", () => {
    const files = [
      logFile("perf-20261014-1402-sm-a266b.jsonl", { bytes: 2_100_000, lines: 9000, sent: 9000 }),
      logFile("perf-20261014-1530-sm-a266b.jsonl", { sent: 100 }),
      logFile("perf-20261014-1532-sm-a266b.jsonl", { current: true })
    ];
    const rows = view({ files }).files;
    expect(rows.map(row => [row.size, row.status, row.statusText, row.canDelete])).toEqual([
      ["2.1 MB", "sent", "sent", true],
      ["412 KB", "partial", "100 of 1 840 sent", true],
      ["412 KB", "current", "current", false]
    ]);
    expect(rows[0]?.time).toBe("15:32");
  });

  it("lists the marks with their time and the auto note", () => {
    const tab = view({
      marks: [
        { atMs: 64_000, label: "boss enters", auto: false },
        { atMs: 150_000, label: "Glow off", auto: true }
      ]
    });
    expect(tab.marks).toEqual([
      { time: "01:04", label: "boss enters", auto: false },
      { time: "02:30", label: "Glow off", auto: true }
    ]);
  });
});
