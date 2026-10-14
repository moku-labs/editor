import { describe, expect, it } from "vitest";
import { causeName, causesOf, changesOf, primaryCause } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// The editor's ranking of a spike's causes over the engine's cause bits
// (bit 0 gap, 1 js, 2 gpu, 3 compile, 4 upload, 5 longFrame, 6 gc?).
// ─────────────────────────────────────────────────────────────────────────────

/** The bit of each cause in the engine's PerfCause order. */
const BIT = { gap: 1, js: 2, gpu: 4, compile: 8, upload: 16, longFrame: 32, gc: 64 } as const;

describe("primaryCause", () => {
  it("ranks gpu › upload › compile › longFrame › js › gc? › gap (bug: a spike coloured by the wrong cause)", () => {
    expect(primaryCause(BIT.js | BIT.upload)).toBe(2);
    expect(primaryCause(BIT.gap | BIT.gc)).toBe(6);
    expect(primaryCause(BIT.longFrame | BIT.js)).toBe(4);
    expect(primaryCause(BIT.gpu | BIT.compile)).toBe(1);
    expect(primaryCause(BIT.gap)).toBe(7);
  });

  it("answers 0 for a frame that is not a spike", () => {
    expect(primaryCause(0)).toBe(0);
  });
});

describe("causesOf and causeName", () => {
  it("lists the primary cause first, then the others by rank", () => {
    expect(causesOf(BIT.longFrame | BIT.js)).toEqual(["longFrame", "js"]);
    expect(causesOf(BIT.gap | BIT.js | BIT.upload)).toEqual(["upload", "js", "gap"]);
    expect(causesOf(0)).toEqual([]);
  });

  it("names a primary cause code, and nothing for 0 or out of range", () => {
    expect(causeName(primaryCause(BIT.compile | BIT.gc))).toBe("compile");
    expect(causeName(6)).toBe("gc?");
    expect([causeName(0), causeName(8)]).toEqual([undefined, undefined]);
  });
});

describe("changesOf", () => {
  it("reads the changed bits in PerfChange order (bug: a bundle change shown as a scene change)", () => {
    expect(changesOf(0b0_1000)).toEqual(["bundle"]);
    expect(changesOf(0b1_0101)).toEqual(["resize", "scene", "restore"]);
    expect(changesOf(0)).toEqual([]);
  });
});
