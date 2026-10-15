/* eslint-disable unicorn/no-null -- null is "the display rate is not known" */
import { describe, expect, it } from "vitest";
import {
  causeName,
  causesOf,
  changesOf,
  isNotableGap,
  primaryCause,
  spikeCause
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// The editor's ranking of a spike's causes over the engine's cause bits
// (bit 0 gap, 1 js, 2 gpu, 3 compile, 4 upload, 5 longFrame, 6 gc?).
// ─────────────────────────────────────────────────────────────────────────────

/** The bit of each cause in the engine's PerfCause order. */
const BIT = { gap: 1, js: 2, gpu: 4, compile: 8, upload: 16, longFrame: 32, gc: 64 } as const;

describe("primaryCause", () => {
  it("walks the ranks without an iterator: nothing allocated per frame on the 4 Hz read (bug: a for…of per frame)", () => {
    // A plain counting patch, restored at once (a vitest spy would iterate arrays itself).
    const original = Array.prototype[Symbol.iterator];
    let iterators = 0;
    let code = 0;
    Array.prototype[Symbol.iterator] = function counted(this: unknown[]) {
      iterators += 1;
      return original.call(this);
    };
    try {
      code = primaryCause(BIT.gap);
    } finally {
      Array.prototype[Symbol.iterator] = original;
    }
    expect([code, iterators]).toEqual([7, 0]);
  });

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

describe("spikeCause (spec 03 delta 2026-10-15)", () => {
  it("never flags a resting frame or a break, whatever its bits (bug: a spike per second on a still screen)", () => {
    for (const bits of [BIT.gap, BIT.gap | BIT.js, BIT.longFrame | BIT.gap, BIT.gpu]) {
      expect(spikeCause(bits, 1)).toBe(0);
      expect(spikeCause(bits, 3)).toBe(0);
    }
  });

  it("judges an awake frame by its work: a pause, a GC hint or an upload without work is no spike (bug: GAP noise)", () => {
    expect(spikeCause(BIT.gap, 0)).toBe(0);
    expect(spikeCause(BIT.gap | BIT.gc, 0)).toBe(0);
    expect(spikeCause(BIT.gap | BIT.upload, 0)).toBe(0);
    expect(spikeCause(BIT.js | BIT.gap, 0)).toBe(primaryCause(BIT.js));
    expect(spikeCause(BIT.js | BIT.upload, 0)).toBe(primaryCause(BIT.upload));
    expect(spikeCause(BIT.longFrame | BIT.gap, 0)).toBe(primaryCause(BIT.longFrame));
    expect(spikeCause(BIT.gpu, 0)).toBe(primaryCause(BIT.gpu));
    expect(spikeCause(0, 0)).toBe(0);
  });

  it("keeps the work of the wake after a rest but not its gap", () => {
    expect(spikeCause(BIT.gap, 2)).toBe(0);
    expect(spikeCause(BIT.gap | BIT.js, 2)).toBe(primaryCause(BIT.js));
  });
});

describe("isNotableGap", () => {
  it("judges a gap against the budget or the display's frame, whichever is longer (bug: every vsync flagged at 120 fps on a 60 Hz display)", () => {
    expect(isNotableGap(16.7, 8.33, 60)).toBe(false);
    expect(isNotableGap(25, 8.33, 60)).toBe(false);
    expect(isNotableGap(25.1, 8.33, 60)).toBe(true);
    expect(isNotableGap(16.7, 8.33, null)).toBe(true);
    expect(isNotableGap(17.7, 16.67, 60)).toBe(false);
    expect(isNotableGap(Number.NaN, 16.67, 60)).toBe(false);
  });
});
