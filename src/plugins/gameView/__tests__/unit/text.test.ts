import { describe, expect, it } from "vitest";
import { styleValue } from "../../ui/text";

describe("styleValue", () => {
  it("shows strings and numbers as they are", () => {
    expect(styleValue("center")).toBe("center");
    expect(styleValue(144)).toBe("144");
    expect(styleValue(true)).toBe("true");
  });

  it("shows an object as key value pairs joined by a middle dot", () => {
    expect(styleValue({ top: 266, right: 72, bottom: 64, left: 72 })).toBe(
      "top 266 · right 72 · bottom 64 · left 72"
    );
    expect(styleValue({})).toBe("");
  });

  it("joins an array with commas, nested values the same way", () => {
    expect(styleValue(["a", 2])).toBe("a, 2");
    expect(styleValue([{ x: 1, y: 2 }, [3, 4]])).toBe("x 1 · y 2, 3, 4");
  });
});
