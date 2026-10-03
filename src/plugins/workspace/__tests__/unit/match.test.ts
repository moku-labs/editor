import { describe, expect, it, vi } from "vitest";
import { fuzzyScore, scoreItem } from "../../palette/match";
import type { PaletteItem } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Palette scoring: prefix 100 > word start 80 > substring 60; fuzzy fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A palette item.
 *
 * @param label - Its label.
 * @param keywords - Extra words.
 * @returns The item.
 */
function itemOf(label: string, keywords?: string): PaletteItem {
  return keywords === undefined
    ? { id: label, group: "Nodes", label, run: vi.fn() }
    : { id: label, group: "Nodes", label, keywords, run: vi.fn() };
}

describe("scoreItem", () => {
  it("an empty query matches everything without a highlight", () => {
    expect(scoreItem(itemOf("board/merge"), "  ")).toEqual({ score: 0, ranges: [] });
  });

  it("scores a prefix 100 with one range", () => {
    expect(scoreItem(itemOf("Board/merge"), "boa")).toEqual({ score: 100, ranges: [[0, 3]] });
  });

  it("scores a word start 80", () => {
    expect(scoreItem(itemOf("board/merge"), "mer")).toEqual({ score: 80, ranges: [[6, 9]] });
    expect(scoreItem(itemOf("Take a screenshot"), "scr")).toEqual({
      score: 80,
      ranges: [[7, 10]]
    });
  });

  it("scores a substring 60", () => {
    expect(scoreItem(itemOf("board/merge"), "erg")).toEqual({ score: 60, ranges: [[7, 10]] });
  });

  it("matches keywords without a label highlight", () => {
    expect(scoreItem(itemOf("Step 1 frame", "advance tick"), "tick")).toEqual({
      score: 80,
      ranges: []
    });
  });

  it("returns undefined without a substring hit", () => {
    expect(scoreItem(itemOf("board/merge"), "bmg")).toBeUndefined();
  });
});

describe("fuzzyScore", () => {
  it("matches a subsequence with one range per character and a contiguity bonus", () => {
    expect(fuzzyScore("board/merge", "bmg")).toEqual({
      score: 20,
      ranges: [
        [0, 1],
        [6, 7],
        [9, 10]
      ]
    });
    expect(fuzzyScore("board/merge", "bome")?.score).toBe(22);
  });

  it("ignores case and spaces in the query", () => {
    expect(fuzzyScore("Pause or resume", "p r")?.ranges).toEqual([
      [0, 1],
      [7, 8]
    ]);
  });

  it("returns undefined when the letters are not in order", () => {
    expect(fuzzyScore("board", "db")).toBeUndefined();
    expect(fuzzyScore("board", "")).toBeUndefined();
  });
});
