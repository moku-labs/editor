/* eslint-disable unicorn/no-null -- null is the engine's "not reported" */
import { describe, expect, it } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import { isPerfSecond, isRecorderStatus, isSpikeList, isSpikeRecord } from "../../device/guards";
import {
  recorderOf,
  recordOf,
  sampleOf,
  secondOf,
  spikeLineOf,
  summaryOf
} from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// device/guards.ts: a value off the wire passes only when every member the strip
// reads has its type, so derive and record never throw on it (review W1).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A fixture as the wire carries it, with one member replaced by an off-shape value.
 *
 * @param value - The fixture.
 * @param patch - The members to replace, as plain JSON.
 * @returns The wire value.
 */
function offShape(value: object, patch: object): unknown {
  return { ...(toWireValue(value) as object), ...patch };
}

describe("isSpikeList", () => {
  it("refuses a spike whose cause, or any of its causes, is not a known cause", () => {
    expect(isSpikeList(toWireValue([summaryOf(4812, ["upload", "gap"])]))).toBe(true);
    expect(isSpikeList([offShape(summaryOf(4812, ["upload"]), { cause: "boom" })])).toBe(false);
    expect(
      isSpikeList([offShape(summaryOf(4812, ["upload"]), { causes: ["upload", "boom"] })])
    ).toBe(false);
    expect(isSpikeList([offShape(summaryOf(4812, ["upload"]), { cause: "toString" })])).toBe(false);
  });
});

describe("isPerfSecond", () => {
  it("accepts the demo second", () => {
    expect(isPerfSecond(toWireValue(secondOf()))).toBe(true);
    expect(isPerfSecond(toWireValue(secondOf({ render: null, sample: null, display: null })))).toBe(
      true
    );
  });

  it("refuses a second whose display, sample, render, device or gpu members the strip reads are off-shape", () => {
    const second = toWireValue(secondOf()) as { [key: string]: object };
    const display = second.display ?? {};
    const sample = toWireValue(sampleOf()) as object;
    const bad: object[] = [
      { display: { ...display, canvas: undefined } },
      { display: { ...display, resolution: "1" } },
      { display: { ...display, safeArea: null } },
      { sample: { ...sample, gapMs: { p90: "18" } } },
      { sample: { ...sample, textures: null } },
      { sample: { ...sample, systems: [{ name: 1, mean: 2 }] } },
      { sample: { ...sample, filters: {} } },
      { render: { passesMax: 3, kept: {}, redraws: 0, rebuilds: 0 } },
      { device: { model: "SM-A266B" } },
      { gpu: {} },
      { rate: { fps: 60, mode: "auto", reason: 7, displayHz: 120, switches: 1 } },
      {
        activity: { idle: "yes", idleSince: null, idleFrames: 0, idleMs: 0, breaks: 0, p90Ms: null }
      },
      {
        activity: { idle: true, idleSince: "now", idleFrames: 0, idleMs: 0, breaks: 0, p90Ms: null }
      },
      {
        activity: { idle: false, idleSince: null, idleFrames: 0, idleMs: 0, breaks: 0, p90Ms: "17" }
      }
    ];
    for (const patch of bad) {
      expect(isPerfSecond(offShape(secondOf(), patch)), JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("isSpikeRecord", () => {
  it("accepts the demo record, with and without the engine's line", () => {
    expect(isSpikeRecord(toWireValue(recordOf()))).toBe(true);
    expect(isSpikeRecord(toWireValue(recordOf({ detail: null })))).toBe(true);
  });

  it("refuses a record whose detail, longFrames, uploads, phases, passes or events are off-shape", () => {
    const line = toWireValue(spikeLineOf()) as { [key: string]: object };
    const frame = line.frame ?? {};
    const bad: object[] = [
      { detail: {} },
      { detail: { ...line, frame: { ...frame, changed: undefined } } },
      { detail: { ...line, longFrames: undefined } },
      { detail: { ...line, passes: [{ index: 0, kind: "canvas" }] } },
      { detail: { ...line, systems: [{ name: "ripple" }] } },
      { detail: { ...line, filters: [{ kind: "blur" }] } },
      { uploads: { count: 1 } },
      { phases: { input: "x" } },
      { filters: { applies: 4 } },
      { rateSwitch: { from: 120 } },
      { events: [{ kind: "pool-trim", frame: 1, reason: "rest", freedMb: "x" }] },
      { events: [{ kind: "teleport", frame: 1 }] },
      { cause: "boom" }
    ];
    for (const patch of bad) {
      expect(isSpikeRecord(offShape(recordOf(), patch)), JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("no guard throws", () => {
  it("answers false for null, numbers, strings and arrays of them", () => {
    for (const value of [null, 0, "x", [null], [1], { detail: { frame: null } }]) {
      expect(() => isPerfSecond(value)).not.toThrow();
      expect(() => isSpikeList(value)).not.toThrow();
      expect(() => isSpikeRecord(value)).not.toThrow();
      expect(() => isRecorderStatus(value)).not.toThrow();
    }
    expect(isRecorderStatus(toWireValue(recorderOf()))).toBe(true);
  });
});
