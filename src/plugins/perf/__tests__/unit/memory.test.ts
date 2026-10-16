/* eslint-disable unicorn/no-null -- null is "no heap number" and "not a WebView" in the engine's lines */
import { describe, expect, it } from "vitest";
import { memoryWhy } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/memory (spec 03 Delta 2026-10-16 D6): perf never presents a heap it
// cannot stand behind. On the A26 WebView `performance.memory` stayed one value
// for 30 s while the real heap moved.
// ─────────────────────────────────────────────────────────────────────────────

describe("memoryWhy", () => {
  it("answers not-measured for a page without a heap number (bug: iOS shown as 0 MB)", () => {
    expect(memoryWhy(null, null, 0)).toBe("not-measured");
    expect(memoryWhy(Number.NaN, null, 0)).toBe("not-measured");
  });

  it("never trusts a WebView's heap, even while it moves (bug: the A26's frozen 10.68 MB shown as the heap)", () => {
    expect(memoryWhy(10.68, "141", 1)).toBe("webview");
  });

  it("calls a desktop counter frozen at 20 equal samples and still trusts it at 19 (bug: a frozen counter drawn as a flat 'no leak' line)", () => {
    expect(memoryWhy(41.9, null, 19)).toBeNull();
    expect(memoryWhy(41.9, null, 20)).toBe("frozen");
  });
});
