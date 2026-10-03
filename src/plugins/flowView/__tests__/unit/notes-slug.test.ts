import { describe, expect, it } from "vitest";
import { dateStamp, noteFileName, slugOf } from "../../notes/slug";

describe("slugOf", () => {
  it("lowercases and joins [a-z0-9] runs with -", () => {
    expect(slugOf("First wood 4: show a 'new item' popup")).toBe(
      "first-wood-4-show-a-new-item-popup"
    );
    expect(slugOf("  --Hello__World--  ")).toBe("hello-world");
  });

  it("caps at 48 characters without a trailing dash and falls back to note", () => {
    const slug = slugOf(`${"a".repeat(30)} ${"b".repeat(30)}`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
    expect(slugOf("Привет!!!")).toBe("note");
    expect(slugOf("")).toBe("note");
  });
});

describe("noteFileName", () => {
  const date = new Date(2026, 8, 24, 10, 12);

  it("prefixes the local date", () => {
    expect(dateStamp(date)).toBe("2026-09-24");
    expect(noteFileName(date, "First top item", new Set())).toBe("2026-09-24-first-top-item.md");
  });

  it("appends -2, -3 … when the name is taken", () => {
    const taken = new Set(["2026-09-24-first-top-item.md", "2026-09-24-first-top-item-2.md"]);
    expect(noteFileName(date, "First top item", taken)).toBe("2026-09-24-first-top-item-3.md");
  });
});
