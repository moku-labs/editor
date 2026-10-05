import { describe, expect, it } from "vitest";
import { checkMaxWidth, cropRect, scaledSize } from "../../scale";
import { thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The size math of editor.capture: the maxWidth range check, the scaled size
// and the crop of a page rect in picture pixels (the page's canvas lives in
// canvas.ts, the decode and encode in picture.ts).
// ─────────────────────────────────────────────────────────────────────────────

describe("checkMaxWidth", () => {
  it("passes an absent maxWidth and every whole number from 64 to 4096", () => {
    expect(checkMaxWidth(undefined)).toBeUndefined();
    expect(checkMaxWidth(64)).toBe(64);
    expect(checkMaxWidth(1080)).toBe(1080);
    expect(checkMaxWidth(4096)).toBe(4096);
  });

  it.each([63, 4097, 540.5, Number.NaN])("refuses %s with -32602 naming maxWidth", maxWidth => {
    expect(thrownBy(() => checkMaxWidth(maxWidth))).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", retryable: false, id: "editor.capture", field: "maxWidth" }
    });
  });
});

describe("scaledSize", () => {
  it("shrinks a wider picture to maxWidth and keeps the aspect, rounded", () => {
    expect(scaledSize(1080, 1920, 540)).toEqual({ width: 540, height: 960 });
    expect(scaledSize(1080, 1920, 64)).toEqual({ width: 64, height: 114 });
  });

  it("keeps at least one pixel of height", () => {
    expect(scaledSize(4000, 1, 64)).toEqual({ width: 64, height: 1 });
  });

  it("answers undefined when the picture is not wider than maxWidth", () => {
    expect(scaledSize(1080, 1920, 1080)).toBeUndefined();
    expect(scaledSize(800, 600, 1080)).toBeUndefined();
  });
});

describe("cropRect", () => {
  it("scales the page rect by picture width / device width and pads 8 × scale", () => {
    expect(cropRect({ x: 10, y: 20, w: 100, h: 50 }, { width: 1080, height: 1920 }, 540)).toEqual({
      x: 4,
      y: 24,
      width: 232,
      height: 132
    });
  });

  it("clamps the padded rect to the picture", () => {
    const picture = { width: 1080, height: 1920 };

    expect(cropRect({ x: 0, y: 0, w: 50, h: 50 }, picture, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 58,
      height: 58
    });
    expect(cropRect({ x: 1060, y: 1900, w: 40, h: 40 }, picture, 1080)).toEqual({
      x: 1052,
      y: 1892,
      width: 28,
      height: 28
    });
  });

  it("widens a fractional rect to whole pixels (floor the start, ceil the end)", () => {
    expect(cropRect({ x: 10.5, y: 0, w: 10, h: 10 }, { width: 1179, height: 2556 }, 393)).toEqual({
      x: 7,
      y: 0,
      width: 79,
      height: 54
    });
  });

  it("takes scale 1 when the device width is unknown (headless)", () => {
    expect(cropRect({ x: 100, y: 100, w: 10, h: 10 }, { width: 1080, height: 1920 }, 0)).toEqual({
      x: 92,
      y: 92,
      width: 26,
      height: 26
    });
  });

  it("answers undefined for a rect outside the picture", () => {
    const picture = { width: 1080, height: 1920 };

    expect(cropRect({ x: 2000, y: 0, w: 10, h: 10 }, picture, 1080)).toBeUndefined();
    expect(cropRect({ x: 0, y: -100, w: 10, h: 10 }, picture, 1080)).toBeUndefined();
  });
});
