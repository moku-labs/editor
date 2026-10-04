import { describe, expect, it } from "vitest";
import { previewZoneInsets, revealPoint } from "../../camera/chrome";

const S = { width: 150, height: 280 } as const;
const L = { width: 340, height: 660 } as const;

/** The float rect the workspace places: 12 px from the zone edge plus the insets. */
function floatBox(
  canvas: { w: number; h: number },
  insets: { top: number; bottom: number },
  corner: "bottom-left" | "bottom-right",
  size: { width: number; height: number }
): { left: number; top: number; right: number; bottom: number } {
  const left = corner === "bottom-left" ? 12 : canvas.w - 12 - size.width;
  const top = canvas.h - 12 - insets.bottom - size.height;
  return { left, top, right: left + size.width, bottom: top + size.height };
}

/** The minimap rect from minimap.css: 202×130, right 12, bottom 12 (56 under 480 px) plus lift. */
function minimapBox(
  canvas: { w: number; h: number },
  lift: number
): { left: number; top: number; right: number; bottom: number } {
  const bottom = canvas.h - (canvas.w <= 480 ? 56 : 12) - lift;
  return { left: canvas.w - 12 - 202, top: bottom - 130, right: canvas.w - 12, bottom };
}

/** True when two rects share area. */
function meet(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("previewZoneInsets", () => {
  it("lifts a bottom-right float above the minimap on the half-screen canvases", () => {
    // 720 px window: 368 px canvas, the minimap sits above the zoom bar row.
    const half = { w: 368, h: 856 };
    expect(previewZoneInsets(half, 0, { corner: "bottom-right", ...S })).toEqual({
      top: 56,
      bottom: 186
    });
    // 960 px window: 572 px canvas, the minimap sits 12 px from the bottom.
    const wide = { w: 572, h: 1036 };
    expect(previewZoneInsets(wide, 0, { corner: "bottom-right", ...S })).toEqual({
      top: 56,
      bottom: 142
    });
  });

  it("never lets the float meet the minimap, with the strip closed or open", () => {
    for (const canvas of [
      { w: 368, h: 856 },
      { w: 572, h: 1036 },
      { w: 1088, h: 856 }
    ]) {
      for (const lift of [0, 224]) {
        for (const corner of ["bottom-left", "bottom-right"] as const) {
          const insets = previewZoneInsets(canvas, lift, { corner, ...S });
          const float = floatBox(canvas, insets, corner, S);
          expect(meet(float, minimapBox(canvas, lift)), `${canvas.w} ${lift} ${corner}`).toBe(
            false
          );
          expect(float.top, "under the top band").toBeGreaterThanOrEqual(56 + 12);
        }
      }
    }
  });

  it("keeps only the zoom bar band and the strip where the float is clear of the minimap", () => {
    const canvas = { w: 1088, h: 856 };
    expect(previewZoneInsets(canvas, 0, { corner: "bottom-left", ...S })).toEqual({
      top: 56,
      bottom: 56
    });
    expect(previewZoneInsets(canvas, 224, { corner: "top-right", ...S })).toEqual({
      top: 56,
      bottom: 280
    });
  });

  it("raises a tall float only as far as it still fits under the top band", () => {
    const canvas = { w: 368, h: 856 };
    // L: 856 − 56 − 24 − 660 = 116 px of room, under the 186 px the minimap asks for.
    expect(previewZoneInsets(canvas, 0, { corner: "bottom-right", ...L })).toEqual({
      top: 56,
      bottom: 116
    });
    // Never under the zoom bar band.
    expect(previewZoneInsets({ w: 368, h: 600 }, 0, { corner: "bottom-right", ...L }).bottom).toBe(
      56
    );
  });

  it("treats an unmeasured canvas as wide", () => {
    expect(previewZoneInsets({ w: 0, h: 0 }, 0, { corner: "bottom-right", ...S })).toEqual({
      top: 56,
      bottom: 56
    });
  });
});

describe("revealPoint", () => {
  const canvas = { left: 100, top: 50, right: 500, bottom: 350 };

  it("returns undefined for an element fully inside the canvas", () => {
    const inside = { left: 120, top: 60, right: 292, bottom: 106 };
    expect(revealPoint(inside, canvas, { x: 0, y: 0, z: 1 })).toBeUndefined();
  });

  it("returns the world centre of an element outside or across the canvas edge", () => {
    const cam = { x: -200, y: 40, z: 2 };
    const outside = { left: 600, top: 400, right: 944, bottom: 492 };
    // Centre in canvas px: (672, 396); world = (672 + 200) / 2, (396 − 40) / 2.
    expect(revealPoint(outside, canvas, cam)).toEqual({ x: 436, y: 178 });
    const across = { left: 450, top: 100, right: 622, bottom: 146 };
    expect(revealPoint(across, canvas, { x: 0, y: 0, z: 1 })).toEqual({ x: 436, y: 73 });
  });
});
