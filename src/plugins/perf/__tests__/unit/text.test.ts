import { describe, expect, it } from "vitest";
import { cleanText } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// cleanText: a phone's text made safe to print in a terminal or a page.
// ─────────────────────────────────────────────────────────────────────────────

describe("cleanText", () => {
  it("drops C0 controls, DEL, C1 controls, bidi embeddings, overrides and isolates (bug: a phone's text rewriting the terminal)", () => {
    expect(cleanText("a\u0000b\tc\nd\u001B[31me\u007Ff\u0085g\u009Bh‪i‮j⁦k⁩l‫m⁧n")).toBe(
      "abcd[31mefghijklmn"
    );
  });

  it("keeps other text, accents and emoji untouched", () => {
    expect(cleanText("Garden — boss é 🐝  ")).toBe("Garden — boss é 🐝  ");
  });

  it("caps the length at 128 characters by default and at max, never splitting a character", () => {
    expect(cleanText("x".repeat(200))).toBe("x".repeat(128));
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText("ab🐝c", 3)).toBe("ab🐝");
  });
});
