/* eslint-disable unicorn/no-null -- null is "not known" on the digest, the device and the pairing request */
import { describe, expect, it } from "vitest";
import { isStaleLine, LIVE_EVERY_MS, newLiveMemory, perfLiveLines } from "../../live";
import { digestOf, LOG_FILE, sessionEvent } from "../helpers";

/** The computer's engine in these tests: the same as the phone's. */
const SAME = "0.14.12+9c41e0";

/** The header and REC lines of the fixture phone. */
const HEADER = [
  "◉ SM-A266B · webgpu · engine 0.14.12+9c41e0 · build debug-20261014T160000Z · adb 127.0.0.1",
  `  ● REC → ${LOG_FILE}`
];

/** The spec's stats line. */
const STATS =
  "  garden/boss  @60  54 fps  p90 18.2  gpu 6.1  spikes 2 (upload, gc?)  38.0 °C  · 1 840 lines";

describe("perfLiveLines header", () => {
  it("prints the header and REC once per log, then only stats", () => {
    const memory = newLiveMemory();
    expect(perfLiveLines(sessionEvent(), memory, 0, SAME)).toEqual([...HEADER, STATS]);
    expect(perfLiveLines(sessionEvent(), memory, LIVE_EVERY_MS, SAME)).toEqual([STATS]);
  });

  it("prints the header again when the engine or the build changes", () => {
    const memory = newLiveMemory();
    perfLiveLines(sessionEvent(), memory, 0, SAME);
    const rebuilt = sessionEvent({ last: digestOf({ build: "debug-2" }) });
    expect(perfLiveLines(rebuilt, memory, 1, SAME)[0]).toContain("build debug-2");
    const newEngine = sessionEvent({ last: digestOf({ build: "debug-2", engine: "0.14.13+1" }) });
    expect(perfLiveLines(newEngine, memory, 2, "0.14.13+1")[0]).toContain("engine 0.14.13+1");
    expect(perfLiveLines(newEngine, memory, 3, "0.14.13+1")).toEqual([]);
  });
});

describe("perfLiveLines STALE", () => {
  it("warns once per log and engine pair when the phone's engine differs from the computer's", () => {
    const memory = newLiveMemory();
    const first = perfLiveLines(sessionEvent(), memory, 0, "0.14.13+1ab7f2");
    const stale = first.filter(line => isStaleLine(line));
    expect(stale).toEqual([
      "STALE: SM-A266B runs engine 0.14.12+9c41e0, this computer has 0.14.13+1ab7f2 · rebuild the game so the logs match"
    ]);
    expect(
      perfLiveLines(sessionEvent(), memory, 1, "0.14.13+1ab7f2").some(line => isStaleLine(line))
    ).toBe(false);
    expect(
      perfLiveLines(sessionEvent(), memory, 2, "0.14.14+0").some(line => isStaleLine(line))
    ).toBe(true);
  });

  it("never warns when either engine is unknown or null (a source checkout)", () => {
    const unknownHere = perfLiveLines(sessionEvent(), newLiveMemory(), 0, "unknown");
    expect(unknownHere.some(line => isStaleLine(line))).toBe(false);
    const noPhoneEngine = sessionEvent({
      device: { ...sessionEvent().device, engine: null },
      last: digestOf({ engine: null })
    });
    expect(
      perfLiveLines(noPhoneEngine, newLiveMemory(), 0, `${SAME}x`).some(line => isStaleLine(line))
    ).toBe(false);
    const unknownThere = sessionEvent({ last: digestOf({ engine: "unknown" }) });
    expect(
      perfLiveLines(unknownThere, newLiveMemory(), 0, SAME).some(line => isStaleLine(line))
    ).toBe(false);
  });
});

describe("perfLiveLines stats", () => {
  it("prints a stats line at most every 5 s per log", () => {
    const memory = newLiveMemory();
    perfLiveLines(sessionEvent(), memory, 1000, SAME);
    expect(perfLiveLines(sessionEvent(), memory, 1000 + LIVE_EVERY_MS - 1, SAME)).toEqual([]);
    expect(perfLiveLines(sessionEvent(), memory, 1000 + LIVE_EVERY_MS, SAME)).toEqual([STATS]);
  });

  it("prints at once when the path or the rate changes (the fall back from 120 to 60)", () => {
    const memory = newLiveMemory();
    perfLiveLines(sessionEvent({ last: digestOf({ rate: 120 }) }), memory, 0, SAME);
    expect(perfLiveLines(sessionEvent(), memory, 1, SAME)).toEqual([STATS]);
    const settings = sessionEvent({ last: digestOf({ path: "settings" }) });
    expect(perfLiveLines(settings, memory, 2, SAME)[0]).toMatch(/^ {2}settings {2}@60/);
  });

  it("leaves @rate out when the rate is null and prints — for a null value", () => {
    const event = sessionEvent({ last: digestOf({ rate: null, p90Ms: null, gpuMs: null }) });
    const stats = perfLiveLines(event, newLiveMemory(), 0, SAME)[2];
    expect(stats).toBe(
      "  garden/boss  54 fps  p90 —  gpu —  spikes 2 (upload, gc?)  38.0 °C  · 1 840 lines"
    );
  });

  it("prints spikes 0 without causes, the heat only with a reading, and lost only when > 0", () => {
    const calm = sessionEvent({
      lines: 12,
      lost: 3,
      last: digestOf({ spikes: 0, causes: [], thermal: { status: 1, batteryC: null } })
    });
    const stats = perfLiveLines(calm, newLiveMemory(), 0, SAME)[2];
    expect(stats).toBe(
      "  garden/boss  @60  54 fps  p90 18.2  gpu 6.1  spikes 0  · 12 lines · 3 lost"
    );
  });

  it("prints no stats line before the first digest", () => {
    expect(perfLiveLines(sessionEvent({ last: null }), newLiveMemory(), 0, SAME)).toEqual([
      "◉ SM-A266B · engine 0.14.12+9c41e0 · build debug-20261014T160000Z · adb 127.0.0.1",
      `  ● REC → ${LOG_FILE}`
    ]);
  });
});

describe("perfLiveLines away and done", () => {
  it("prints the left line once and the done line once", () => {
    const memory = newLiveMemory();
    perfLiveLines(sessionEvent(), memory, 0, SAME);
    const away = sessionEvent({ state: "away" });
    expect(perfLiveLines(away, memory, 1, SAME)).toEqual([
      "  ○ SM-A266B left · 1 840 lines kept, the log continues when it comes back"
    ]);
    expect(perfLiveLines(away, memory, 2, SAME)).toEqual([]);
    const done = sessionEvent({ state: "done" });
    expect(perfLiveLines(done, memory, 3, SAME)).toEqual([
      `  ■ SM-A266B · 1 840 lines → ${LOG_FILE}`
    ]);
    expect(perfLiveLines(done, memory, 4, SAME)).toEqual([]);
  });
});
