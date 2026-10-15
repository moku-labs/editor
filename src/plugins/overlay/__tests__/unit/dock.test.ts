import { describe, expect, it } from "vitest";
import { range, snap, topOf, windowSize } from "../../place/dock";
import type { Insets } from "../../types";

const PHONE = { w: 384, h: 833 };
const INSETS: Insets = { top: 32, right: 0, bottom: 24, left: 0 };
const CARD = { w: 344, h: 372, compact: false };

describe("windowSize", () => {
  it("a 360-wide phone gets the 344 card (it gets the 300 compact card)", () => {
    expect(windowSize("card", { w: 360, h: 780 })).toEqual({ w: 300, h: 351, compact: true });
    expect(windowSize("card", PHONE)).toEqual(CARD);
  });

  it("a landscape phone gets a 172 px card (it keeps 240)", () => {
    expect(windowSize("card", { w: 833, h: 384 }).h).toBe(240);
  });

  it("leaves the game a 40 px strip and sizes the pill and hidden", () => {
    expect(windowSize("card", { w: 320, h: 700 }).w).toBe(280);
    expect(windowSize("pill", PHONE)).toEqual({ w: 138, h: 36, compact: false });
    expect(windowSize("hidden", PHONE)).toEqual({ w: 0, h: 0, compact: false });
  });
});

describe("topOf, range and snap", () => {
  it("the default card covers the bottom safe inset (top 429 for 384 × 833, insets 32 / 24)", () => {
    expect(topOf({ dock: "right", y: 1 }, CARD, PHONE, INSETS)).toBe(429);
    expect(topOf({ dock: "right", y: 0 }, CARD, PHONE, INSETS)).toBe(40);
    expect(range(CARD, PHONE, INSETS)).toEqual({ minTop: 40, maxTop: 429 });
  });

  it("a drop right of centre docks left (it docks right)", () => {
    expect(snap({ centerX: 300, top: 200 }, CARD, PHONE, INSETS).dock).toBe("right");
    expect(snap({ centerX: 100, top: 200 }, CARD, PHONE, INSETS).dock).toBe("left");
  });

  it("a drop above the safe top keeps the card under the status bar", () => {
    expect(snap({ centerX: 300, top: -50 }, CARD, PHONE, INSETS)).toEqual({ dock: "right", y: 0 });
    expect(snap({ centerX: 300, top: 2000 }, CARD, PHONE, INSETS)).toEqual({ dock: "right", y: 1 });
    expect(snap({ centerX: 300, top: 234.5 }, CARD, PHONE, INSETS).y).toBeCloseTo(0.5);
  });

  it("a range of 0 divides by zero (y = 0)", () => {
    const tall = { w: 300, h: 900, compact: true };
    expect(range(tall, PHONE, INSETS)).toEqual({ minTop: 40, maxTop: 40 });
    expect(snap({ centerX: 10, top: 300 }, tall, PHONE, INSETS)).toEqual({ dock: "left", y: 0 });
    expect(topOf({ dock: "left", y: 0.7 }, tall, PHONE, INSETS)).toBe(40);
  });
});
