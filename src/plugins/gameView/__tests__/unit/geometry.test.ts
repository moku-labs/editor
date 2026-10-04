import { describe, expect, it } from "vitest";
import type { DeviceSpec } from "../../../registry/protocol";
import { DEVICES, presetOf, resolveDevice, screenOf } from "../../../workspace/devices";
import {
  bezelOf,
  drawerCover,
  fitScale,
  frameOf,
  hasHomeBar,
  hasIsland,
  kindScale,
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

/** The iPhone SE 3 with its home-button frame (round 2b R9). */
const SE_HOME: DeviceSpec = { ...presetOf("iphone-se"), frame: "home-button" as const };

/** The phones of the list, with the SE in its home-button frame. */
const PHONES: readonly DeviceSpec[] = DEVICES.map(device =>
  device.id === "iphone-se" ? SE_HOME : device
);

describe("frameOf and bezelOf (round 2b R9)", () => {
  it("reads the frame, modern by default", () => {
    expect(frameOf(SE_HOME)).toBe("home-button");
    expect(frameOf(presetOf("iphone-15"))).toBe("modern");
  });

  it("is 10 px all round for a modern phone or a tablet, nothing for the desktop", () => {
    const modern = { top: 10, right: 10, bottom: 10, left: 10 };
    expect(bezelOf(presetOf("iphone-15"), "portrait")).toEqual(modern);
    expect(bezelOf(presetOf("ipad-mini"), "landscape")).toEqual(modern);
    expect(bezelOf(presetOf("desktop"), "portrait")).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    });
  });

  it("is 64 px above and below a home-button screen, 10 at the sides; turned in landscape", () => {
    expect(bezelOf(SE_HOME, "portrait")).toEqual({ top: 64, right: 10, bottom: 64, left: 10 });
    expect(bezelOf(SE_HOME, "landscape")).toEqual({ top: 10, right: 64, bottom: 10, left: 64 });
  });
});

describe("fitScale with a bezel (round 2b R9)", () => {
  it("leaves room for the home-button bezel: pad 6 + 64 + 64 in height", () => {
    const se = resolveDevice(SE_HOME, "portrait");
    expect(fitScale(STAGE, se, false, bezelOf(SE_HOME, "portrait"))).toBeCloseTo(
      (800 - 56 - 6 - 128) / 667,
      6
    );
  });
});

describe("kindScale (round 2b R9)", () => {
  const stage = { w: 1200, h: 900 };

  it("gives every phone the scale of the tallest phone with its bezel", () => {
    // The tallest modern phone binds: k·h + 10 + 10 ≤ 900 − 56 − 6.
    const modern = PHONES.filter(p => p.kind === "phone" && frameOf(p) === "modern");
    const expected = (900 - 56 - 26) / Math.max(...modern.map(p => p.h));
    const se = kindScale(stage, PHONES, SE_HOME, "portrait");
    const proMax = kindScale(stage, PHONES, presetOf("iphone-15-pro-max"), "portrait");
    expect(se).toBeCloseTo(expected, 6);
    expect(proMax).toBe(se);
  });

  it("shows an SE visibly smaller than a Pro Max at that scale", () => {
    const scale = kindScale(stage, PHONES, SE_HOME, "portrait");
    const se = slotSize(resolveDevice(SE_HOME, "portrait"), scale);
    const proMax = slotSize(resolveDevice(presetOf("iphone-15-pro-max"), "portrait"), scale);
    expect(se.h).toBeLessThan(proMax.h * 0.75);
  });

  it("gives the foldables the phone scale, tablets and the desktop their own", () => {
    const phone = kindScale(stage, PHONES, presetOf("iphone-15"), "portrait");
    expect(kindScale(stage, PHONES, presetOf("galaxy-z-fold-6"), "portrait")).toBe(phone);
    const tablet = kindScale(stage, PHONES, presetOf("ipad-mini"), "portrait");
    expect(tablet).toBeCloseTo((900 - 56 - 26) / 1180, 6);
    expect(kindScale(stage, PHONES, presetOf("ipad-air-11"), "portrait")).toBe(tablet);
    expect(kindScale(stage, PHONES, presetOf("desktop"), "portrait")).toBeCloseTo(
      (1200 - 56 - 32) / 1440,
      6
    );
  });

  it("still fits a screen the list does not hold, like an unfolded inner screen", () => {
    const narrow = { w: 700, h: 900 };
    const inner = screenOf(presetOf("pixel-9-pro-fold"), false);
    const scale = kindScale(narrow, PHONES, inner, "portrait");
    expect(scale).toBeCloseTo((700 - 56 - 26) / 791, 6);
    expect(inner.w * scale).toBeLessThanOrEqual(700 - 56 - 26 + 1e-9);
  });

  it("fits every phone of the list at the shared scale in landscape too", () => {
    const scale = kindScale(stage, PHONES, presetOf("iphone-15"), "landscape");
    for (const preset of PHONES.filter(p => p.kind === "phone")) {
      const size = resolveDevice(preset, "landscape");
      const bezel = bezelOf(preset, "landscape");
      expect(size.w * scale + bezel.left + bezel.right).toBeLessThanOrEqual(1200 - 56 - 6 + 1e-9);
      expect(size.h * scale + bezel.top + bezel.bottom).toBeLessThanOrEqual(900 - 56 - 6 + 1e-9);
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

  it("neither on a home-button phone (round 2b R9)", () => {
    expect(hasIsland("phone", 59, "home-button")).toBe(false);
    expect(hasHomeBar("phone", 34, "home-button")).toBe(false);
    expect(hasIsland("phone", 59, "modern")).toBe(true);
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
