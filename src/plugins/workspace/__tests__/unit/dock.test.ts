import { describe, expect, it } from "vitest";
import {
  centreBox,
  clipInsets,
  fitScale,
  floatRect,
  nearestCorner,
  PREVIEW_SIZES,
  resolveInsets
} from "../../frame/dock";

// ─────────────────────────────────────────────────────────────────────────────
// Pure frame geometry: scale, centring, clip insets, corners, the preview float
// ─────────────────────────────────────────────────────────────────────────────

const device = { w: 393, h: 852 };

describe("fitScale", () => {
  it("fit takes the smaller ratio and caps at 1 for the stage", () => {
    expect(fitScale({ w: 393, h: 426 }, device, "fit", true)).toBeCloseTo(0.5);
    expect(fitScale({ w: 2000, h: 2000 }, device, "fit", true)).toBe(1);
  });

  it("fit without the cap grows past 1 (the preview)", () => {
    expect(fitScale({ w: 786, h: 1704 }, device, "fit", false)).toBe(2);
  });

  it("actual is always 1", () => {
    expect(fitScale({ w: 100, h: 100 }, device, "actual", true)).toBe(1);
  });

  it("an empty slot or an empty device gives 0", () => {
    expect(fitScale({ w: 0, h: 500 }, device, "fit", true)).toBe(0);
    expect(fitScale({ w: 500, h: 500 }, { w: 0, h: 0 }, "fit", true)).toBe(0);
  });
});

describe("centreBox", () => {
  it("centres the scaled device in the slot", () => {
    const slot = { left: 100, top: 50, width: 400, height: 900 };
    expect(centreBox(slot, device, 1)).toEqual({ left: 103.5, top: 74 });
    expect(centreBox(slot, { w: 400, h: 800 }, 0.5)).toEqual({ left: 200, top: 300 });
  });
});

describe("clipInsets", () => {
  it("returns zero insets when the clip holds the whole box", () => {
    const box = {
      left: 10,
      top: 10,
      width: 100,
      height: 200,
      scale: 1,
      docked: "stage" as const
    };
    expect(clipInsets(box, { left: 0, top: 0, width: 500, height: 500 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    });
  });

  it("converts the overflow to local px at scale 0.5", () => {
    const box = {
      left: 0,
      top: 0,
      width: 200,
      height: 400,
      scale: 0.5,
      docked: "stage" as const
    };
    // clip cuts 20 px on the left, 40 px on top, 30 px right, 50 px bottom (page px)
    expect(clipInsets(box, { left: 20, top: 40, width: 150, height: 310 })).toEqual({
      top: 80,
      right: 60,
      bottom: 100,
      left: 40
    });
  });

  it("a zero scale clips nothing", () => {
    const box = { left: 0, top: 0, width: 0, height: 0, scale: 0, docked: "hidden" as const };
    expect(clipInsets(box, { left: 5, top: 5, width: 1, height: 1 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    });
  });
});

describe("nearestCorner", () => {
  const zone = { left: 0, top: 0, width: 1000, height: 800 };

  it("picks the quadrant of the point", () => {
    expect(nearestCorner({ x: 10, y: 10 }, zone)).toBe("top-left");
    expect(nearestCorner({ x: 900, y: 10 }, zone)).toBe("top-right");
    expect(nearestCorner({ x: 10, y: 700 }, zone)).toBe("bottom-left");
    expect(nearestCorner({ x: 900, y: 700 }, zone)).toBe("bottom-right");
  });
});

describe("floatRect and PREVIEW_SIZES", () => {
  const zone = { left: 52, top: 44, width: 1000, height: 800 };

  it("knows the three float sizes", () => {
    expect(PREVIEW_SIZES).toEqual({
      S: { w: 150, h: 280 },
      M: { w: 280, h: 540 },
      L: { w: 340, h: 660 }
    });
  });

  it("places the float 12 px inside the chosen corner plus the zone insets", () => {
    const insets = resolveInsets({ bottom: 40 });
    expect(floatRect(zone, insets, "bottom-right", PREVIEW_SIZES.S)).toEqual({
      left: 52 + 1000 - 12 - 150,
      top: 44 + 800 - 12 - 40 - 280,
      width: 150,
      height: 280
    });
    expect(floatRect(zone, resolveInsets(undefined), "top-left", PREVIEW_SIZES.M)).toEqual({
      left: 64,
      top: 56,
      width: 280,
      height: 540
    });
  });

  // The 480 px Claude pane: the Flow canvas starts at 44 px (after the rail), 436 px wide.
  const pane = { left: 44, top: 44, width: 436, height: 800 };

  it("keeps the float inside the zone next to a wide drawer: never over the rail", () => {
    // A 304 px Inspector drawer leaves 436 - 304 - 24 = 108 px: S keeps its height, fits the width.
    const float = floatRect(pane, resolveInsets({ right: 304 }), "bottom-right", PREVIEW_SIZES.S);
    expect(float).toEqual({ left: 56, top: 44 + 800 - 12 - 280, width: 108, height: 280 });
    expect(float.left).toBeGreaterThanOrEqual(pane.left + 12);
  });

  it("scales a size that does not fit down to the zone, keeping its aspect", () => {
    // M next to the 240 px drawer: 172 px of room, 280×540 becomes 172×331.
    const float = floatRect(pane, resolveInsets({ right: 240 }), "bottom-left", PREVIEW_SIZES.M);
    expect(float).toEqual({ left: 56, top: 44 + 800 - 12 - 331, width: 172, height: 331 });
    // L in a short zone: the height decides, 340×660 becomes 257×500.
    const short = { left: 0, top: 0, width: 1000, height: 524 };
    expect(floatRect(short, resolveInsets(undefined), "top-right", PREVIEW_SIZES.L)).toEqual({
      left: 1000 - 12 - 257,
      top: 12,
      width: 257,
      height: 500
    });
  });

  it("never scales below the height of S; when even S does not fit, it fits the zone", () => {
    // M in 140 px of room would be 140×270: below 280, so S's box clipped to the zone.
    const narrow = { left: 0, top: 0, width: 164, height: 900 };
    expect(floatRect(narrow, resolveInsets(undefined), "top-left", PREVIEW_SIZES.M)).toEqual({
      left: 12,
      top: 12,
      width: 140,
      height: 280
    });
    // A zone 200 px tall: S keeps its width and takes the height there is.
    const low = { left: 0, top: 0, width: 800, height: 224 };
    expect(floatRect(low, resolveInsets(undefined), "bottom-right", PREVIEW_SIZES.S)).toEqual({
      left: 800 - 12 - 150,
      top: 12,
      width: 150,
      height: 200
    });
  });

  it("keeps a size that fits as it is", () => {
    expect(floatRect(pane, resolveInsets({ right: 240 }), "bottom-right", PREVIEW_SIZES.S)).toEqual(
      { left: 44 + 436 - 12 - 240 - 150, top: 44 + 800 - 12 - 280, width: 150, height: 280 }
    );
  });

  it("resolves insets from an object or a function; missing sides are 0", () => {
    expect(resolveInsets({ top: 3 })).toEqual({ top: 3, right: 0, bottom: 0, left: 0 });
    expect(resolveInsets(() => ({ left: 7, right: 2 }))).toEqual({
      top: 0,
      right: 2,
      bottom: 0,
      left: 7
    });
  });
});
