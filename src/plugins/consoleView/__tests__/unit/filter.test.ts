import { describe, expect, it } from "vitest";
import { countLevels, emptyStateOf, splitHits, visibleLines } from "../../filter";
import type { LogLine } from "../../types";
import { entryLine, metaLine } from "../helpers";

const LINES: readonly LogLine[] = [
  entryLine(1, { level: "debug", source: "flow", message: "tick" }),
  entryLine(2, { level: "info", source: "assets", message: "bundle loaded" }),
  metaLine(3),
  entryLine(4, { level: "warn", source: "assets", message: "missing texture UI.gear" }),
  entryLine(5, { level: "error", source: "editor", message: "-32602 game.step" })
];

describe("visibleLines", () => {
  it("'all' shows every entry including debug", () => {
    expect(visibleLines(LINES, "all", "").map(line => line.key)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a level shows only its entries, meta rows always", () => {
    expect(visibleLines(LINES, "warn", "").map(line => line.key)).toEqual([3, 4]);
    expect(visibleLines(LINES, "info", "").map(line => line.key)).toEqual([2, 3]);
    expect(visibleLines(LINES, "error", "").map(line => line.key)).toEqual([3, 5]);
  });

  it("matches the query case-insensitively over source and message", () => {
    expect(visibleLines(LINES, "all", "ui.GEAR").map(line => line.key)).toEqual([3, 4]);
    expect(visibleLines(LINES, "all", "assets").map(line => line.key)).toEqual([2, 3, 4]);
    expect(visibleLines(LINES, "all", "assets bundle").map(line => line.key)).toEqual([2, 3]);
    expect(visibleLines(LINES, "info", "texture").map(line => line.key)).toEqual([3]);
  });
});

describe("countLevels", () => {
  it("counts entry lines per level plus all, ignoring meta rows", () => {
    expect(countLevels(LINES)).toEqual({ all: 4, debug: 1, info: 1, warn: 1, error: 1 });
    expect(countLevels([])).toEqual({ all: 0, debug: 0, info: 0, warn: 0, error: 0 });
  });
});

describe("splitHits", () => {
  it("returns alternating parts with the hits marked, case-insensitively", () => {
    expect(splitHits("missing texture Texture", "texture")).toEqual([
      { text: "missing ", hit: false },
      { text: "texture", hit: true },
      { text: " ", hit: false },
      { text: "Texture", hit: true }
    ]);
  });

  it("returns the whole text when the query is empty or absent", () => {
    expect(splitHits("abc", "")).toEqual([{ text: "abc", hit: false }]);
    expect(splitHits("abc", "zz")).toEqual([{ text: "abc", hit: false }]);
  });

  it("treats regex characters literally", () => {
    expect(splitHits("a.b (c)* a+b", "(c)*")).toEqual([
      { text: "a.b ", hit: false },
      { text: "(c)*", hit: true },
      { text: " a+b", hit: false }
    ]);
    expect(splitHits("axb a.b", ".")).toEqual([
      { text: "axb a", hit: false },
      { text: ".", hit: true },
      { text: "b", hit: false }
    ]);
  });
});

describe("emptyStateOf", () => {
  it("names the three Console empty states", () => {
    expect(emptyStateOf([], [], false)).toBe(
      "No game connected. The log starts when a game connects."
    );
    expect(emptyStateOf([metaLine(1)], [metaLine(1)], true)).toBe(
      "The log is empty. Lines appear here as the game logs."
    );
    expect(emptyStateOf(LINES, [metaLine(3)], true)).toBe("No lines match this filter.");
    expect(emptyStateOf(LINES, LINES, false)).toBeUndefined();
  });
});
