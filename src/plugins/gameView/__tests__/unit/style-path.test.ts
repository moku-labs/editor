import { describe, expect, it } from "vitest";
import { sourcePaths, stylePathOf, writtenStyle } from "../../element/style-path";
import type { StyleSource } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// What an index answer says about its style, pure: the file the style is written
// in, every file the answer was read from (a change to one makes it stale), and
// the style as it is written on the element.
// ─────────────────────────────────────────────────────────────────────────────

/** merge-game's giftReward: the prop in daily-gift.tsx, the text style in <Amount>. */
const REWARD: StyleSource = {
  kind: "defined",
  path: "features/gift/popups/daily-gift.tsx",
  line: 25,
  range: [23, 9, 29, 11],
  textStyle: "ui.amount",
  stylePath: "shared/views/amount.tsx"
};

/** A text node with its text style key on its own tag. */
const LINK: StyleSource = {
  kind: "defined",
  path: "a.tsx",
  line: 1,
  range: [1, 1, 1, 54],
  textStyle: "ui.link"
};

/** An id prop whose component draws its element without a style. */
const BARE: StyleSource = {
  kind: "defined",
  path: "src/hud/Hud.tsx",
  line: 2,
  range: [1, 1, 3, 3],
  stylelessPaths: ["src/kit/pill.tsx"]
};

describe("stylePathOf", () => {
  it("is the file the style was read from: the component of an id prop, else the key file", () => {
    expect(stylePathOf(REWARD)).toBe("shared/views/amount.tsx");
    expect(stylePathOf(LINK)).toBe("a.tsx");
  });
});

describe("sourcePaths", () => {
  it("is the key file alone for an answer read from one file", () => {
    expect(sourcePaths(LINK)).toEqual(["a.tsx"]);
  });

  it("adds the component file the style of an id prop was read from", () => {
    expect(sourcePaths(REWARD)).toEqual([
      "features/gift/popups/daily-gift.tsx",
      "shared/views/amount.tsx"
    ]);
  });

  it("adds the component files that gave an id prop no style", () => {
    expect(sourcePaths(BARE)).toEqual(["src/hud/Hud.tsx", "src/kit/pill.tsx"]);
    expect(sourcePaths({ ...REWARD, stylelessPaths: ["shared/views/amount.ts"] })).toEqual([
      "features/gift/popups/daily-gift.tsx",
      "shared/views/amount.tsx",
      "shared/views/amount.ts"
    ]);
  });
});

describe("writtenStyle", () => {
  it("is the identifier of style={ident} and the call of style={call(…)} as written", () => {
    expect(
      writtenStyle({
        kind: "ident",
        path: "src/hud/Hud.tsx",
        line: 2,
        range: [2, 1, 2, 42],
        ref: { kind: "const", name: "coinPill" },
        files: ["src/hud/styles.ts"]
      })
    ).toBe("coinPill");
    expect(
      writtenStyle({
        kind: "call",
        path: "features/orders/strip.tsx",
        line: 216,
        range: [215, 5, 247, 14],
        call: "orderCardStyle(card.slot)",
        callLine: 218
      })
    ).toBe("orderCardStyle(card.slot)");
  });

  it("is undefined for a text style key, an element without a style, or no answer", () => {
    expect(writtenStyle(REWARD)).toBeUndefined();
    expect(writtenStyle(BARE)).toBeUndefined();
    expect(writtenStyle(undefined)).toBeUndefined();
  });
});
