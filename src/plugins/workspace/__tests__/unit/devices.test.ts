import { describe, expect, it } from "vitest";
import { DEVICES, deviceById, isDevicePresetId, presetOf, resolveDevice } from "../../devices";

// ─────────────────────────────────────────────────────────────────────────────
// The six presets (design §8) and the orientation rule (R8)
// ─────────────────────────────────────────────────────────────────────────────

describe("DEVICES", () => {
  it("lists the six presets in display order with name and kind", () => {
    expect(DEVICES.map(device => device.id)).toEqual([
      "iphone-se",
      "iphone-15",
      "iphone-15-pro-max",
      "pixel-8",
      "ipad-mini",
      "desktop"
    ]);
    expect(DEVICES.map(device => `${device.name} ${device.w}×${device.h} ${device.kind}`)).toEqual([
      "iPhone SE 375×667 phone",
      "iPhone 15 393×852 phone",
      "iPhone 15 Pro Max 430×932 phone",
      "Pixel 8 412×915 phone",
      "iPad mini 744×1133 tablet",
      "Desktop 1440×900 desktop"
    ]);
  });

  it("finds a preset by id and rejects unknown ids", () => {
    expect(deviceById("pixel-8")?.safeTop).toBe(24);
    expect(deviceById("nokia")).toBeUndefined();
    expect(isDevicePresetId("ipad-mini")).toBe(true);
    expect(isDevicePresetId("nokia")).toBe(false);
    expect(isDevicePresetId(3)).toBe(false);
    expect(presetOf("nokia").id).toBe("iphone-15");
  });
});

describe("resolveDevice", () => {
  const iphone15 = presetOf("iphone-15");

  it("portrait keeps W×H and puts safeTop/safeBottom on top and bottom", () => {
    expect(resolveDevice(iphone15, "portrait")).toEqual({
      w: 393,
      h: 852,
      safe: { top: 59, right: 0, bottom: 34, left: 0 }
    });
  });

  it("landscape swaps W and H; left = right = safeTop, bottom = safeBottom", () => {
    expect(resolveDevice(iphone15, "landscape")).toEqual({
      w: 852,
      h: 393,
      safe: { top: 0, right: 59, bottom: 34, left: 59 }
    });
  });

  it("a desktop has no safe insets in either orientation", () => {
    const desktop = presetOf("desktop");
    expect(resolveDevice(desktop, "portrait").safe).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    });
    expect(resolveDevice(desktop, "landscape")).toMatchObject({ w: 900, h: 1440 });
  });
});
