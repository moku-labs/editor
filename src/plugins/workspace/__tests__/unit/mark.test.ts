import { describe, expect, it } from "vitest";
import { markOf } from "../../mark";

// ─────────────────────────────────────────────────────────────────────────────
// The game mark of the top bar (U1): initials and a hue, both from the game name
// ─────────────────────────────────────────────────────────────────────────────

describe("markOf", () => {
  it("two words or more: the first letters of the first two words, upper case", () => {
    expect(markOf("Tic Tac Toe").text).toBe("TT");
    expect(markOf("tic-tac-toe").text).toBe("TT");
    expect(markOf("merge-game").text).toBe("MG");
    expect(markOf("merge_game").text).toBe("MG");
    expect(markOf("merge  -  game").text).toBe("MG");
  });

  it("one word: its first two letters, upper case; one letter stays one", () => {
    expect(markOf("Merge").text).toBe("ME");
    expect(markOf("ticktoe").text).toBe("TI");
    expect(markOf("x").text).toBe("X");
  });

  it("no game: a middle dot and no hue", () => {
    expect(markOf(undefined)).toEqual({ text: "·", hue: undefined });
    expect(markOf("")).toEqual({ text: "·", hue: undefined });
    expect(markOf("   ")).toEqual({ text: "·", hue: undefined });
  });

  it("a name of separators only has no letter to show: the dot, no hue", () => {
    expect(markOf("--")).toEqual({ text: "·", hue: undefined });
    expect(markOf(" _ - ")).toEqual({ text: "·", hue: undefined });
  });

  it("the hue is the sum of code × position over the trimmed lower-case name, mod 360", () => {
    // "x" is one character, code 120, at position 1.
    expect(markOf("x").hue).toBe(120);
    // "ab": 97 × 1 + 98 × 2 = 293.
    expect(markOf("ab").hue).toBe(293);
    expect(markOf("Tic Tac Toe")).toEqual({ text: "TT", hue: 7 });
    expect(markOf("tic-tac-toe")).toEqual({ text: "TT", hue: 163 });
    expect(markOf("Merge")).toEqual({ text: "ME", hue: 130 });
    expect(markOf("merge-game")).toEqual({ text: "MG", hue: 288 });
  });

  it("the same name twice gives the same hue, whatever its case and its outer spaces", () => {
    expect(markOf("Merge").hue).toBe(markOf("Merge").hue);
    expect(markOf("  MERGE ").hue).toBe(markOf("merge").hue);
  });

  it("every hue is a whole number from 0 to 359", () => {
    for (const name of ["a", "Tic Tac Toe", "merge-game 2", "ÿ".repeat(40), "🙂 game"]) {
      const { hue } = markOf(name);
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
