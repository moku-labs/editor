import { describe, expect, it } from "vitest";
import { DEVICES, presetOf, resolveDevice } from "../../../workspace/devices";
import {
  drawerCover,
  fitScale,
  hasHomeBar,
  hasIsland,
  safeBands,
  slotSize
} from "../../stage/geometry";

const STAGE = { w: 1200, h: 800 };

describe("fitScale", () => {
  it("is min(1, (stageW − 56 − pad) / W, (stageH − 56 − pad) / H), pad 26 for devices", () => {
    const iphone = resolveDevice(presetOf("iphone-15"), "portrait");
    expect(fitScale(STAGE, iphone, false)).toBeCloseTo((800 - 56 - 26) / 852, 6);
  });

  it("uses pad 32 for the desktop", () => {
    const desktop = resolveDevice(presetOf("desktop"), "portrait");
    expect(fitScale(STAGE, desktop, true)).toBeCloseTo((1200 - 56 - 32) / 1440, 6);
  });

  it("never scales above 1 and never below 0", () => {
    const se = resolveDevice(presetOf("iphone-se"), "portrait");
    expect(fitScale({ w: 4000, h: 4000 }, se, false)).toBe(1);
    expect(fitScale({ w: 10, h: 10 }, se, false)).toBe(0);
  });

  it("fits every preset in both orientations inside the stage", () => {
    for (const preset of DEVICES) {
      for (const orientation of ["portrait", "landscape"] as const) {
        const size = resolveDevice(preset, orientation);
        const desktop = preset.kind === "desktop";
        const k = fitScale(STAGE, size, desktop);
        const pad = desktop ? 32 : 26;
        expect(size.w * k).toBeLessThanOrEqual(STAGE.w - 56 - pad + 1e-9);
        expect(size.h * k).toBeLessThanOrEqual(STAGE.h - 56 - pad + 1e-9);
        expect(k).toBeGreaterThan(0);
        expect(k).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("slotSize", () => {
  it("is W·k × H·k", () => {
    expect(slotSize(resolveDevice(presetOf("iphone-15"), "landscape"), 0.5)).toEqual({
      w: 426,
      h: 196.5
    });
  });
});

describe("safeBands", () => {
  it("follows resolveDevice: top and bottom in portrait", () => {
    expect(safeBands(resolveDevice(presetOf("iphone-15"), "portrait"))).toEqual([
      { side: "top", size: 59 },
      { side: "bottom", size: 34 }
    ]);
  });

  it("left, right and bottom in landscape", () => {
    expect(safeBands(resolveDevice(presetOf("iphone-15"), "landscape"))).toEqual([
      { side: "right", size: 59 },
      { side: "bottom", size: 34 },
      { side: "left", size: 59 }
    ]);
  });

  it("none for the desktop; only the top for the iPhone SE", () => {
    expect(safeBands(resolveDevice(presetOf("desktop"), "portrait"))).toEqual([]);
    expect(safeBands(resolveDevice(presetOf("iphone-se"), "portrait"))).toEqual([
      { side: "top", size: 20 }
    ]);
  });
});

describe("dynamic island and home bar", () => {
  it("island for phones with safeTop ≥ 59", () => {
    expect(hasIsland("phone", 59)).toBe(true);
    expect(hasIsland("phone", 24)).toBe(false);
    expect(hasIsland("tablet", 59)).toBe(false);
  });

  it("home bar for phones with safeBottom ≥ 16", () => {
    expect(hasHomeBar("phone", 16)).toBe(true);
    expect(hasHomeBar("phone", 0)).toBe(false);
    expect(hasHomeBar("desktop", 34)).toBe(false);
  });
});

describe("drawerCover", () => {
  it("is the strip from the drawer's left edge to the stage's right edge", () => {
    expect(drawerCover({ left: 0, right: 480 }, 197)).toBe(283);
  });

  it("is 0 when the drawer starts at or past the stage's right edge", () => {
    expect(drawerCover({ left: 0, right: 448 }, 448)).toBe(0);
    expect(drawerCover({ left: 0, right: 448 }, 460)).toBe(0);
  });

  it("never covers more than the whole stage", () => {
    expect(drawerCover({ left: 100, right: 480 }, 40)).toBe(380);
  });
});
