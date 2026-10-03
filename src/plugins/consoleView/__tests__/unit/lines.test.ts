import { afterEach, describe, expect, it, vi } from "vitest";
import type { RanEvent } from "../../../workspace/types";
import {
  formatTime,
  frameMarkOf,
  frameText,
  frameTitle,
  isTraceEntry,
  messageOf,
  sourceOf,
  statusFrame,
  summarize,
  tagOf,
  toCommandLine,
  toEntryLine
} from "../../lines";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sourceOf", () => {
  it("takes the head of the event before the first colon", () => {
    expect(sourceOf({ level: "warn", event: "assets: missing texture", ts: 1 })).toBe("assets");
    expect(sourceOf({ level: "info", event: "flow:enter:twice", ts: 1 })).toBe("flow");
  });

  it("falls back to the plugin, then to game, when the event has no source head", () => {
    expect(sourceOf({ level: "info", event: "boot", plugin: "flow", ts: 1 })).toBe("flow");
    expect(sourceOf({ level: "info", event: "boot", ts: 1 })).toBe("game");
    expect(sourceOf({ level: "info", event: "not a source: x", ts: 1 })).toBe("game");
    expect(sourceOf({ level: "info", event: "9lives: x", ts: 1 })).toBe("game");
  });
});

describe("summarize", () => {
  it("joins string data with a middle dot and stringifies other JSON", () => {
    expect(summarize(undefined, 160)).toBe("");
    expect(summarize("s-7f3a", 160)).toBe(" · s-7f3a");
    expect(summarize({ key: "ui.gear" }, 160)).toBe(' {"key":"ui.gear"}');
    expect(summarize(4, 160)).toBe(" 4");
  });

  it("cuts long JSON at the limit with an ellipsis", () => {
    const summary = summarize({ text: "x".repeat(300) }, 20);
    expect(summary).toBe(` ${'{"text":"xxxxxxxxxxx'}…`);
    expect(summary.length).toBe(22);
  });
});

describe("messageOf", () => {
  it("is the rest of the event plus the data summary", () => {
    const entry = {
      level: "warn" as const,
      event: "assets: missing texture",
      data: { key: "ui.gear" },
      ts: 1
    };
    expect(messageOf(entry, 160)).toBe('missing texture {"key":"ui.gear"}');
  });

  it("joins string data with a middle dot", () => {
    expect(
      messageOf({ level: "info", event: "editor: agent attached", data: "s-7f3a", ts: 1 }, 160)
    ).toBe("agent attached · s-7f3a");
  });

  it("keeps the whole event when it has no source head", () => {
    expect(messageOf({ level: "info", event: "boot done", ts: 1 }, 160)).toBe("boot done");
  });

  it("shows only the data when the event has nothing after the source", () => {
    expect(messageOf({ level: "info", event: "flow:", data: { a: 1 }, ts: 1 }, 160)).toBe(
      '{"a":1}'
    );
    expect(messageOf({ level: "info", event: "flow:", data: "hi", ts: 1 }, 160)).toBe("hi");
  });
});

describe("isTraceEntry", () => {
  it("accepts a log entry", () => {
    expect(isTraceEntry({ level: "info", event: "a", ts: 1 })).toBe(true);
    expect(isTraceEntry({ level: "debug", event: "a", ts: 1, plugin: "flow", data: [1] })).toBe(
      true
    );
  });

  it("rejects missing ts, unknown levels and non-objects", () => {
    expect(isTraceEntry({ level: "info", event: "a" })).toBe(false);
    expect(isTraceEntry({ level: "fatal", event: "a", ts: 1 })).toBe(false);
    expect(isTraceEntry({ level: "info", event: 3, ts: 1 })).toBe(false);
    expect(isTraceEntry({ level: "info", event: "a", ts: 1, plugin: 3 })).toBe(false);
    expect(isTraceEntry(undefined)).toBe(false);
    expect(isTraceEntry([1])).toBe(false);
    expect(isTraceEntry("info")).toBe(false);
  });
});

describe("frameMarkOf", () => {
  it("is exact when data.frame is a number", () => {
    expect(frameMarkOf({ level: "info", event: "a", data: { frame: 1778 }, ts: 1 }, 1840)).toEqual({
      value: 1778,
      exact: true
    });
  });

  it("is 'at or before' the arrival frame otherwise, and absent without one", () => {
    expect(frameMarkOf({ level: "info", event: "a", data: "x", ts: 1 }, 1840)).toEqual({
      value: 1840,
      exact: false
    });
    expect(frameMarkOf({ level: "info", event: "a", ts: 1 }, undefined)).toBeUndefined();
  });
});

describe("statusFrame", () => {
  it("reads the frame of a live, paused, silent or lost status", () => {
    expect(statusFrame({ kind: "live", frame: 1840 })).toBe(1840);
    expect(statusFrame({ kind: "paused", frame: 12 })).toBe(12);
    expect(statusFrame({ kind: "silent", since: 1, lastFrame: 9 })).toBe(9);
    expect(statusFrame({ kind: "lost", reason: "x", lastFrame: 8, retryInMs: 1 })).toBe(8);
    expect(statusFrame({ kind: "connecting" })).toBeUndefined();
    expect(statusFrame({ kind: "empty" })).toBeUndefined();
  });
});

describe("toEntryLine", () => {
  it("builds an entry line stamped with the ingest time", () => {
    vi.spyOn(Date, "now").mockReturnValue(5000);
    const line = toEntryLine(
      { level: "warn", event: "assets: missing texture", data: { key: "ui.gear" }, ts: 1040 },
      7,
      { value: 1840, exact: false },
      160
    );
    expect(line).toEqual({
      kind: "entry",
      key: 7,
      level: "warn",
      source: "assets",
      message: 'missing texture {"key":"ui.gear"}',
      event: "assets: missing texture",
      data: { key: "ui.gear" },
      ts: 1040,
      frame: { value: 1840, exact: false },
      addedAt: 5000
    });
  });

  it("carries no data key when the entry has none", () => {
    const line = toEntryLine({ level: "info", event: "boot", ts: 1 }, 1, undefined, 160);
    expect("data" in line).toBe(false);
    expect(line.frame).toBeUndefined();
  });
});

describe("toCommandLine", () => {
  it("builds the D1 error line without the [moku-editor] prefix", () => {
    vi.spyOn(Date, "now").mockReturnValue(9000);
    const ran: Extract<RanEvent, { ok: false }> = {
      id: "game.step",
      input: { frames: "x" },
      origin: "topbar",
      at: 8000,
      ok: false,
      error: {
        code: -32_602,
        message: "[moku-editor] game.step: frames must be a number",
        data: { reason: "invalid_input", field: "frames" }
      }
    };
    expect(toCommandLine(ran, 4, 1840)).toEqual({
      kind: "entry",
      key: 4,
      level: "error",
      source: "editor",
      message: "-32602 game.step: frames must be a number",
      event: "game.step",
      data: { command: "game.step", reason: "invalid_input", field: "frames" },
      ts: 8000,
      frame: { value: 1840, exact: false },
      addedAt: 9000
    });
  });

  it("has no frame when the link reports none", () => {
    const line = toCommandLine(
      {
        id: "game.pause",
        input: undefined,
        origin: "key",
        at: 1,
        ok: false,
        error: { code: -32_000, message: "no session" }
      },
      1,
      undefined
    );
    expect(line.frame).toBeUndefined();
    expect(line.data).toEqual({ command: "game.pause" });
    expect(line.message).toBe("-32000 no session");
  });
});

describe("formatTime", () => {
  it("formats a timestamp as local HH:MM:SS.mmm", () => {
    expect(formatTime(new Date(2026, 8, 24, 10, 12, 3, 45).getTime())).toBe("10:12:03.045");
    expect(formatTime(new Date(2026, 8, 24, 0, 0, 0, 0).getTime())).toBe("00:00:00.000");
  });
});

describe("tagOf, frameText, frameTitle", () => {
  it("maps levels to the shared tag atoms", () => {
    expect(["debug", "info", "warn", "error"].map(level => tagOf(level as "info"))).toEqual([
      "mut",
      "mut",
      "warn",
      "err"
    ]);
  });

  it("shows exact frames plain and others as 'at or before'", () => {
    expect(frameText({ value: 1778, exact: true })).toBe("1778");
    expect(frameText({ value: 1840, exact: false })).toBe("≤1840");
    expect(frameTitle({ value: 1778, exact: true })).toBe("Show frame 1778 in Flow");
    expect(frameTitle({ value: 1840, exact: false })).toBe(
      "Logged at or before frame 1840. The engine log carries no frame yet."
    );
  });
});
