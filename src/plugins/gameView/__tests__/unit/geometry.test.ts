import { describe, expect, it } from "vitest";
import type { DeviceSpec } from "../../../registry/protocol";
import { DEVICES, resolveDevice } from "../../../workspace/devices";
import { fitScale, hasHomeBar, hasIsland, safeBands, slotSize } from "../../stage/geometry";

const STAGE = { w: 1200, h: 800 };

/**
 * A preset by its index in DEVICES.
 *
 * @param index - 0 iPhone SE … 5 Desktop.
 * @returns The preset.
 */
function preset(index: number): DeviceSpec {
  const found = DEVICES[index];
  if (found === undefined) throw new Error(`no preset ${index}`);
  return found;
}

describe("fitScale", () => {
  it("is min(1, (stageW − 56 − pad) / W, (stageH − 56 − pad) / H), pad 26 for devices", () => {
    const iphone = resolveDevice(preset(1), "portrait");
    expect(fitScale(STAGE, iphone, false)).toBeCloseTo((800 - 56 - 26) / 852, 6);
  });

  it("uses pad 32 for the desktop", () => {
    const desktop = resolveDevice(preset(5), "portrait");
    expect(fitScale(STAGE, desktop, true)).toBeCloseTo((1200 - 56 - 32) / 1440, 6);
  });

  it("never scales above 1 and never below 0", () => {
    const se = resolveDevice(preset(0), "portrait");
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
    expect(slotSize(resolveDevice(preset(1), "landscape"), 0.5)).toEqual({ w: 426, h: 196.5 });
  });
});

describe("safeBands", () => {
  it("follows resolveDevice: top and bottom in portrait", () => {
    expect(safeBands(resolveDevice(preset(1), "portrait"))).toEqual([
      { side: "top", size: 59 },
      { side: "bottom", size: 34 }
    ]);
  });

  it("left, right and bottom in landscape", () => {
    expect(safeBands(resolveDevice(preset(1), "landscape"))).toEqual([
      { side: "right", size: 59 },
      { side: "bottom", size: 34 },
      { side: "left", size: 59 }
    ]);
  });

  it("none for the desktop; only the top for the iPhone SE", () => {
    expect(safeBands(resolveDevice(preset(5), "portrait"))).toEqual([]);
    expect(safeBands(resolveDevice(preset(0), "portrait"))).toEqual([{ side: "top", size: 20 }]);
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
