/* eslint-disable unicorn/no-null -- null is a JSON value */
import { describe, expect, it, vi } from "vitest";
import { wireError } from "../../../../registry/protocol";
import { withProgress } from "../../../mcp/progress";
import {
  errorResult,
  failureResult,
  imageItem,
  imageKb,
  jsonText,
  pictureResult
} from "../../../mcp/results";
import { chooseSession, livenessProblem } from "../../../mcp/sessions";
import {
  commandOf,
  dataUrlOf,
  pictureOf,
  pictureSize,
  readBeat,
  readDoorManifest,
  readFileEntries,
  readFileText,
  readRunResult,
  readSessionList,
  readShot,
  restoredFrameOf,
  splitDataUrl
} from "../../../mcp/shapes";
import type { SessionView } from "../../../mcp/types";
import { jsonEqual, matcherOf } from "../../../mcp/wait";
import { jpegOf, pngOf } from "../../mcp-tools";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp pure helpers: the session choice and liveness rule, JSON equality
// and wait rules, the shape readers, the result builders and progress.
// ─────────────────────────────────────────────────────────────────────────────

/** A JPEG data URL of the given bytes. */
function jpeg(bytes: number[]): string {
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
}

/** A session view. */
function view(id: string, embedded: boolean, heartbeat?: SessionView["heartbeat"]): SessionView {
  const base = { id, game: "g", page: "p", embedded, connectedAt: 1 };
  return heartbeat === undefined ? base : { ...base, heartbeat };
}

describe("chooseSession and livenessProblem (the hub rule, M7)", () => {
  it("picks the asked, the only, or the one embedded session", () => {
    const page = view("s-1", false);
    const pane = view("s-2", true);
    expect(chooseSession([page, pane], "s-1")).toBe(page);
    expect(chooseSession([page, pane], "s-9")).toBeUndefined();
    expect(chooseSession([page], undefined)).toBe(page);
    expect(chooseSession([page, pane], undefined)).toBe(pane);
    expect(chooseSession([page, view("s-3", false)], undefined)).toBeUndefined();
    expect(chooseSession([], undefined)).toBeUndefined();
  });

  it("names a paused or silent game, and lets an unknown or running one go", () => {
    expect(livenessProblem([view("s-1", true)], undefined)).toBeUndefined();
    expect(
      livenessProblem([view("s-1", true, { frame: 3, paused: false, silent: false })], undefined)
    ).toBeUndefined();
    expect(
      livenessProblem([view("s-1", true, { frame: 3, paused: true, silent: false })], "s-1")
    ).toBe("game paused or hidden at frame 3 — bring the editor pane to front or resume");
  });
});

describe("jsonEqual and matcherOf", () => {
  it("compares JSON deeply, whatever the key order", () => {
    expect(jsonEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true);
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonEqual([1], { 0: 1 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual("a", "a")).toBe(true);
  });

  it("matches until, changedFrom and the first change", () => {
    expect(matcherOf({ kind: "until", value: 2 })(2)).toBe(true);
    expect(matcherOf({ kind: "changedFrom", value: 2 })(2)).toBe(false);
    const change = matcherOf({ kind: "change" });
    expect([change(1), change(1), change(2)]).toEqual([false, false, true]);
  });
});

describe("shape readers", () => {
  it("read sessions with their readout and skip malformed entries", () => {
    expect(
      readSessionList({
        list: [
          {
            id: "s-1",
            game: "g",
            page: "p",
            embedded: true,
            connectedAt: 1,
            heartbeat: { frame: 1 }
          },
          { id: "s-2" },
          "x"
        ]
      })
    ).toEqual([{ id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1 }]);
    expect(readSessionList({})).toBeUndefined();
    expect(readSessionList(undefined)).toBeUndefined();
    expect(readBeat({ frame: 1 })).toBeUndefined();
    expect(readBeat(null)).toBeUndefined();
  });

  it("copies a string manifestHash into the session and drops any other value (D-37)", () => {
    const base = { id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1 };
    expect(readSessionList({ list: [{ ...base, manifestHash: "4f528e73" }] })).toEqual([
      { ...base, manifestHash: "4f528e73" }
    ]);
    expect(readSessionList({ list: [{ ...base, manifestHash: 7 }] })).toEqual([base]);
    const beat = { frame: 2, paused: false, silent: true };
    expect(readSessionList({ list: [{ ...base, heartbeat: beat, manifestHash: "h" }] })).toEqual([
      { ...base, heartbeat: beat, manifestHash: "h" }
    ]);
  });

  it("reads the game and the command doors of a manifest, skipping malformed doors", () => {
    const tap = {
      id: "game.tap",
      title: "Tap",
      input: { target: "string", x: "number?" },
      effect: "route"
    };
    expect(
      readDoorManifest({
        game: "g",
        page: "p",
        embedded: true,
        sources: [],
        commands: [
          tap,
          { id: "game.x", title: "X", input: {}, effect: "explode" },
          { id: "game.y", title: "Y", input: { a: "date" }, effect: "read" },
          { id: "game.z", title: "Z", input: [], effect: "read" },
          { id: 1, title: "W", input: {}, effect: "read" },
          "game.v"
        ]
      })
    ).toEqual({ game: "g", commands: [tap] });
    expect(readDoorManifest({ game: "g", commands: "x" })).toBeUndefined();
    expect(readDoorManifest({ commands: [] })).toBeUndefined();
    expect(readDoorManifest(null)).toBeUndefined();
  });

  it("read run results, shots and pictures", () => {
    expect(
      readRunResult({ value: 1, state: { path: "a", frame: "1", tainted: false } })
    ).toBeUndefined();
    expect(readRunResult({ state: {} })).toBeUndefined();
    expect(readShot({ image: "x" })).toBeUndefined();
    expect(readShot([])).toBeUndefined();
    expect(readShot({ image: "x", frame: 1 })).toEqual({ image: "x", frame: 1, device: {} });
    expect(pictureOf("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(pictureOf({ png: "blob:x" })).toBeUndefined();
    expect(splitDataUrl("not a data url")).toBeUndefined();
    expect(pictureSize(pngOf(393, 64))).toEqual({ width: 393, height: 852 });
    expect(pictureSize("data:image/png;base64,AAAA")).toBeUndefined();
    expect(pictureSize("data:image/gif;base64,R0lG")).toBeUndefined();
    expect(pictureSize("not a data url")).toBeUndefined();
  });

  it("reads the size of a JPEG from its SOF0 or SOF2 frame header", () => {
    expect(pictureSize(jpegOf(393, 64))).toEqual({ width: 393, height: 852 });
    expect(pictureSize(jpegOf(1080, 64, 0xc2))).toEqual({ width: 1080, height: 852 });
    expect(pictureSize("data:image/jpeg;base64,/9j/")).toBeUndefined();
    expect(pictureSize("data:image/jpeg;base64,AAAA")).toBeUndefined();
  });

  it("skips fill bytes and standalone markers, and stops at the scan without a frame header", () => {
    const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0x00, 0x00];
    expect(pictureSize(jpeg([0xff, 0xd8, 0xff, 0xff, 0xd0, ...frame]))).toEqual({
      width: 64,
      height: 32
    });
    const scan = [0xff, 0xda, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(pictureSize(jpeg([0xff, 0xd8, ...scan, ...frame]))).toBeUndefined();
    expect(pictureSize(jpeg([0xff, 0xd8, 0x00, 0x00, ...frame]))).toBeUndefined();
  });

  it("read file results and manifest entries", () => {
    expect(readFileEntries("x")).toEqual([]);
    expect(
      readFileEntries([
        { path: "a", kind: "link", size: 1 },
        { path: "b", kind: "dir", size: 0 }
      ])
    ).toEqual([{ path: "b", kind: "dir", size: 0 }]);
    expect(readFileText({ text: 1 })).toBeUndefined();
    expect(readFileText(null)).toBeUndefined();
    expect(dataUrlOf("x")).toBeUndefined();
    expect(commandOf(null, "a")).toBeUndefined();
    expect(commandOf({ commands: [{ id: "b" }] }, "a")).toBeUndefined();
    expect(commandOf({ commands: [{ id: "a" }] }, "a")).toEqual({ effect: "unknown", input: {} });
    expect(restoredFrameOf({ restored: "x" })).toBeUndefined();
    expect(restoredFrameOf(null)).toBeUndefined();
  });
});

describe("result builders", () => {
  it("builds text, error, image and failure results", () => {
    expect(jsonText([1])).toBe("[\n  1\n]");
    expect(errorResult("[moku-editor] boom")).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true
    });
    expect(imageItem("x")).toBeUndefined();
    expect(imageKb("A".repeat(2048))).toBe(2);
    expect(pictureResult({ frame: 1 }, "x")).toEqual({
      content: [{ type: "text", text: '{\n  "frame": 1\n}' }]
    });
    expect(failureResult("plain", [])).toEqual({
      content: [{ type: "text", text: "plain" }],
      isError: true
    });
    const choose = wireError(-32_003, "choose a session", { reason: "choose_session" });
    expect(failureResult(choose, [view("s-1", true)]).content[0]).toEqual({
      type: "text",
      text: "choose a session\nPass session as one of:\n- s-1 g (embedded) p"
    });
  });
});

describe("withProgress", () => {
  it("reports at the start and every second until the work settles", async () => {
    vi.useFakeTimers();
    try {
      const reports: [number, number | undefined][] = [];
      let clock = 0;
      const call = {
        args: {},
        signal: new AbortController().signal,
        progress: (done: number, total?: number) => reports.push([done, total])
      };
      let finish: (value: string) => void = () => {};
      const work = withProgress(
        call,
        3000,
        () => clock,
        () =>
          new Promise<string>(resolve => {
            finish = resolve;
          })
      );
      clock = 1000;
      await vi.advanceTimersByTimeAsync(1000);
      clock = 5000;
      await vi.advanceTimersByTimeAsync(1000);
      finish("done");
      await expect(work).resolves.toBe("done");
      await vi.advanceTimersByTimeAsync(3000);
      expect(reports).toEqual([
        [0, 3000],
        [1000, 3000],
        [3000, 3000]
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
