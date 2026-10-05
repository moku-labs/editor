import { describe, expect, it } from "vitest";
import { linkBadge, styleValue } from "../../ui/text";

describe("linkBadge", () => {
  it("an expected reload (U12) shows the blue Reloading badge with a spinner", () => {
    const status = {
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 1000,
      reloading: true
    } as const;
    expect(linkBadge(status, 0)).toEqual({
      key: "link",
      text: "Reloading · last frame 1825",
      tone: "info",
      spinner: true
    });
  });

  it("a real loss stays the red reconnecting badge", () => {
    const status = {
      kind: "lost",
      reason: "game_reloaded",
      lastFrame: 9,
      retryInMs: 1000
    } as const;
    expect(linkBadge(status, 0)).toMatchObject({
      text: "Game page reloaded, reconnecting · retry in 1 s · last frame 9",
      tone: "error"
    });
  });
});

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
