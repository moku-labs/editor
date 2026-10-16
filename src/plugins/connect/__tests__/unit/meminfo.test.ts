/* eslint-disable unicorn/no-null -- null is "row absent" in ProcessMemory */
import { describe, expect, it } from "vitest";
import { parseMeminfo } from "../../telemetry/meminfo";
import { fixture } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C6: memory per process from dumpsys meminfo's App Summary (KB → MB),
// a whole-process number, never the JS heap.
// ─────────────────────────────────────────────────────────────────────────────

describe("parseMeminfo", () => {
  it("reads the A26 app: TOTAL PSS 541 MB, the App Summary rows and GL mtrack", () => {
    // Bug: KB read as MB.
    expect(parseMeminfo(fixture("meminfo-app.txt"), 23_811, 1_791_986_080_000)).toEqual({
      pid: 23_811,
      totalPssMb: 541,
      javaMb: 18.2,
      nativeMb: 96.4,
      graphicsMb: 210.5,
      glMb: 180.1,
      codeMb: 61.3,
      stackMb: 1.2,
      otherMb: 22.4,
      systemMb: 131,
      at: 1_791_986_080_000
    });
  });

  it("reads the renderer's 424 MB with GL null when the table has no GL mtrack row", () => {
    // Bug: a missing row read as 0.
    const renderer = parseMeminfo(fixture("meminfo-renderer.txt"), 23_870, 5);
    expect(renderer).toMatchObject({ pid: 23_870, totalPssMb: 424, nativeMb: 196.6, glMb: null });
  });

  it("is not-found for a process that is gone and unknown-format without a total", () => {
    expect(parseMeminfo(fixture("meminfo-gone.txt"), 23_811, 5)).toBe("not-found");
    expect(parseMeminfo(" App Summary\n           Java Heap:    18636\n", 23_811, 5)).toBe(
      "unknown-format"
    );
  });

  it("reads an older Android's `TOTAL:` summary line", () => {
    const text =
      " App Summary\n         Native Heap:    10240\n               TOTAL:    20480       TOTAL SWAP PSS:  0\n";
    expect(parseMeminfo(text, 9, 5)).toMatchObject({ totalPssMb: 20, nativeMb: 10, javaMb: null });
  });
});
