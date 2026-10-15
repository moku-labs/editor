/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's lines and perf's values */
import { describe, expect, it } from "vitest";
import { DISPLAY, eventLine, rateChange } from "../../../../../tests/fixtures/fake-monitor";
import {
  announcedHzOf,
  displayHzOf,
  frameEventOf,
  isPerfDisplay,
  isRateChange,
  monitorOf,
  offReasonOf,
  statsOf
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/guards: how perf finds the monitor and reads the engine's details.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Does nothing.
 */
function noop(): void {
  // a member of a fake monitor or renderer
}

/** A monitor with every member perf calls. */
const MONITOR = {
  stream: () => noop,
  frames: () => ({ capacity: 0 }),
  mark: () => undefined,
  event: () => undefined,
  beginAgent: () => undefined,
  endAgent: () => undefined
};

/**
 * A renderer.stats() answer for the tests.
 *
 * @returns The answer.
 */
function debugStats() {
  return {
    renderPasses: 3,
    renderPassesMax: 4,
    kept: { pictures: 1, mb: 1.4, retakes: 0 },
    redraws: 2,
    rebuilds: 5
  };
}

/**
 * A renderer.stats() answer for the tests.
 *
 * @returns The answer.
 */
function releaseStats() {
  return {
    renderPasses: 1,
    renderPassesMax: 1,
    kept: { pictures: 4, mb: 1.6, retakes: 0 }
  };
}

describe("monitorOf and offReasonOf", () => {
  it("a headless app has no renderer", () => {
    const game = { time: {}, flow: {} };
    expect([monitorOf(game), offReasonOf(game)]).toEqual([undefined, "no-renderer"]);
  });

  it("a renderer without monitor, or with one missing beginAgent, has no monitor", () => {
    for (const renderer of [{}, { monitor: { ...MONITOR, beginAgent: undefined } }]) {
      expect(monitorOf({ renderer })).toBeUndefined();
      expect(offReasonOf({ renderer })).toBe("no-monitor");
    }
  });

  it("answers a complete monitor and no off reason", () => {
    const game = { renderer: { monitor: MONITOR } };
    expect(monitorOf(game)).toBe(MONITOR);
    expect(offReasonOf(game)).toBeUndefined();
  });

  it("treats a throwing renderer getter as absent and never throws", () => {
    const game = Object.defineProperty({}, "renderer", {
      get: () => {
        throw new Error("boom");
      }
    });
    expect(() => monitorOf(game)).not.toThrow();
    expect([monitorOf(game), offReasonOf(game)]).toEqual([undefined, "no-renderer"]);
  });
});

describe("statsOf", () => {
  it("copies renderPassesMax, kept, redraws and rebuilds of a debug build", () => {
    const stats = debugStats;
    expect(statsOf({ renderer: { stats } })).toEqual({
      passesMax: 4,
      kept: { pictures: 1, mb: 1.4, retakes: 0 },
      redraws: 2,
      rebuilds: 5
    });
  });

  it("gives null redraws and rebuilds on a production build and keeps kept (bug: redraws shown as 0 where nothing counts them)", () => {
    const stats = releaseStats;
    expect(statsOf({ renderer: { stats } })).toEqual({
      passesMax: 1,
      kept: { pictures: 4, mb: 1.6, retakes: 0 },
      redraws: null,
      rebuilds: null
    });
  });

  it("reads an engine before spec 23 as null kept and passesMax", () => {
    expect(statsOf({ renderer: { stats: () => ({ renderPasses: 1, kept: { mb: 1 } }) } })).toEqual({
      passesMax: null,
      kept: null,
      redraws: null,
      rebuilds: null
    });
  });

  it("answers undefined for a missing or throwing stats, without throwing", () => {
    const throwing = {
      renderer: {
        stats: () => {
          throw new Error("lost");
        }
      }
    };
    expect([statsOf({ renderer: {} }), statsOf(throwing), statsOf(undefined)]).toEqual([
      undefined,
      undefined,
      undefined
    ]);
  });
});

describe("frameEventOf", () => {
  it("reads a game overlay line, what: kept included", () => {
    const line = eventLine("overlay", 4812, {
      entity: 412,
      label: "shopDimLayer",
      what: "kept",
      mode: "freeze"
    });
    expect(frameEventOf(line)).toEqual({
      kind: "overlay",
      frame: 4812,
      label: "shopDimLayer",
      what: "kept",
      mode: "freeze"
    });
  });

  it("refuses an overlay with a what outside the six or without a label", () => {
    const base = { entity: 412, label: "shop", what: "open", mode: "modal" };
    expect(frameEventOf(eventLine("overlay", 1, { ...base, what: "closed" }))).toBeUndefined();
    const { entity, what, mode } = base;
    expect(frameEventOf(eventLine("overlay", 1, { entity, what, mode }))).toBeUndefined();
  });

  it("reads the numbers of a pool-trim and a warm line", () => {
    expect(frameEventOf(eventLine("pool-trim", 4811, { reason: "rest", freedMb: 41.5 }))).toEqual({
      kind: "pool-trim",
      frame: 4811,
      reason: "rest",
      freedMb: 41.5
    });
    expect(frameEventOf(eventLine("warm", 9, { draws: 18 }))).toEqual({
      kind: "warm",
      frame: 9,
      draws: 18
    });
    expect(frameEventOf(eventLine("pool-trim", 9, { reason: "idle", freedMb: 1 }))).toBeUndefined();
  });

  it("is not a game frame event for the editor's devtools line or a line between frames (bug: the editor's own window listed as a game overlay change)", () => {
    expect(
      frameEventOf(eventLine("devtools", 4812, { mode: "card", tab: "frames" }))
    ).toBeUndefined();
    expect(frameEventOf(eventLine("warm", null, { draws: 18 }))).toBeUndefined();
  });
});

describe("isPerfDisplay and isRateChange", () => {
  it("accepts the shapes of 11:960-964 and 21:117-129 and refuses a broken one", () => {
    expect(isPerfDisplay(DISPLAY)).toBe(true);
    expect(isPerfDisplay({ ...DISPLAY, backend: "metal" })).toBe(false);
    expect(isRateChange(rateChange())).toBe(true);
    expect(isRateChange(rateChange({ displayHz: null, thermal: null }))).toBe(true);
    expect(isRateChange({ ...rateChange(), mode: "turbo" })).toBe(false);
    expect(isRateChange({ ...rateChange(), window: { drawn: 1 } })).toBe(false);
  });
});

/**
 * A time.rate() of the engine answering a display rate.
 *
 * @param displayHz - The display rate.
 * @returns The rate function.
 */
function rate(displayHz: number | null) {
  return () => ({ fps: 120, displayHz });
}

describe("displayHzOf", () => {
  it("reads the display rate the engine learned from its time.rate(), null when unknown or missing, never throwing", () => {
    expect(displayHzOf({ time: { rate: rate(120) } })).toBe(120);
    expect(displayHzOf({ time: { rate: rate(null) } })).toBeNull();
    expect(displayHzOf({ time: {} })).toBeNull();
    const broken = {
      time: {
        rate: () => {
          throw new Error("no clock");
        }
      }
    };
    expect(displayHzOf(broken)).toBeNull();
  });
});

describe("announcedHzOf", () => {
  it("reads the display's hz a newer engine announces, null when absent, not a positive number, or a throwing getter", () => {
    expect(announcedHzOf({ ...DISPLAY, hz: 120 })).toBe(120);
    expect(announcedHzOf(DISPLAY)).toBeNull();
    expect(announcedHzOf(undefined)).toBeNull();
    expect(announcedHzOf({ hz: 0 })).toBeNull();
    expect(announcedHzOf({ hz: Number.POSITIVE_INFINITY })).toBeNull();
    const broken = Object.defineProperty({}, "hz", {
      get() {
        throw new Error("gone");
      }
    });
    expect(announcedHzOf(broken)).toBeNull();
  });
});
