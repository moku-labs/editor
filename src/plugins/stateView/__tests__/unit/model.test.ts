/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { describe, expect, it } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { field, frameOf, isModelSnapshot, isRecord } from "../../model";

describe("isModelSnapshot", () => {
  it("accepts { player, session, rng } and { player, session }", () => {
    expect(isModelSnapshot({ player: {}, session: {}, rng: { seed: 1 } })).toBe(true);
    expect(isModelSnapshot({ player: null, session: 1 })).toBe(true);
  });

  it("rejects arrays, null, scalars and a missing player or session", () => {
    expect(isModelSnapshot([{ player: {}, session: {} }])).toBe(false);
    expect(isModelSnapshot(null)).toBe(false);
    expect(isModelSnapshot("model")).toBe(false);
    expect(isModelSnapshot({ session: {} })).toBe(false);
    expect(isModelSnapshot({ player: {} })).toBe(false);
  });
});

describe("frameOf", () => {
  it("reads the frame of every LinkStatus kind", () => {
    const cases: [LinkStatus, number | undefined][] = [
      [{ kind: "connecting" }, undefined],
      [{ kind: "live", frame: 1840 }, 1840],
      [{ kind: "paused", frame: 1841 }, 1841],
      [{ kind: "silent", since: 10, lastFrame: 1842 }, 1842],
      [{ kind: "lost", reason: "game_reloaded", lastFrame: 1843, retryInMs: 1000 }, 1843],
      [{ kind: "empty" }, undefined]
    ];
    for (const [status, frame] of cases) expect(frameOf(status)).toBe(frame);
  });
});

describe("isRecord and field", () => {
  it("reads own fields of plain objects only", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([1])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(field({ a: 1 }, "a")).toBe(1);
    expect(field({ a: 1 }, "constructor")).toBeUndefined();
    expect(field([1], "0")).toBeUndefined();
    expect(field(undefined, "a")).toBeUndefined();
  });
});
