import { describe, expect, expectTypeOf, it } from "vitest";
import type { DevicePresetId, DeviceSize, Orientation } from "../../protocol";
import {
  DEFAULT_DEVICE,
  DEVICE_GROUPS,
  DEVICES,
  deviceById,
  isDevicePresetId,
  presetOf,
  resolveDevice,
  screenOf
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Protocol devices: the presets (round 2 R4, research-devices.md; round 2b R9 frame, R10 current
// iPhones) and the orientation rule (R8). workspace and gameView both import them from here.
// ─────────────────────────────────────────────────────────────────────────────

describe("DEVICES", () => {
  it("lists the twenty-one presets in display order, grouped iPhone → Android → Foldable → Tablet → Desktop", () => {
    expect(DEVICES.map(device => `${device.group} ${device.id}`)).toEqual([
      "iphone iphone-se",
      "iphone iphone-15",
      "iphone iphone-17e",
      "iphone iphone-air",
      "iphone iphone-18-pro",
      "iphone iphone-18-pro-max",
      "iphone iphone-15-pro-max",
      "iphone iphone-16-pro",
      "iphone iphone-16-pro-max",
      "android galaxy-s24",
      "android galaxy-a55",
      "android redmi-note-13",
      "android pixel-8",
      "android xperia-1-v",
      "foldable galaxy-z-fold-6",
      "foldable galaxy-z-flip-6",
      "foldable pixel-9-pro-fold",
      "foldable iphone-duo",
      "tablet ipad-mini",
      "tablet ipad-air-11",
      "desktop desktop"
    ]);
  });

  it("carries the research values: size, dpr, safe insets, corner radius, kind", () => {
    const rows = DEVICES.map(
      device =>
        `${device.name} ${device.w}×${device.h} @${device.dpr} ${device.safeTop}/${device.safeBottom} r${device.radius} ${device.kind}`
    );
    expect(rows).toEqual([
      "iPhone SE 3 · small, 2022 375×667 @2 20/0 r0 phone",
      "iPhone 15 393×852 @3 59/34 r55 phone",
      "iPhone 17e 390×844 @3 47/34 r47 phone",
      "iPhone Air 420×912 @3 68/34 r62 phone",
      "iPhone 18 Pro 402×874 @3 62/34 r62 phone",
      "iPhone 18 Pro Max 440×956 @3 62/34 r62 phone",
      "iPhone 15 Pro Max 430×932 @3 59/34 r55 phone",
      "iPhone 16 Pro 402×874 @3 62/34 r62 phone",
      "iPhone 16 Pro Max 440×956 @3 62/34 r62 phone",
      "Galaxy S24 360×780 @3 0/0 r40 phone",
      "Galaxy A55 412×892 @2.625 0/0 r35 phone",
      "Redmi Note 13 393×873 @2.75 0/0 r35 phone",
      "Pixel 8 412×915 @2.625 0/0 r35 phone",
      "Xperia 1 V 21:9 411×960 @4 0/0 r0 phone",
      "Galaxy Z Fold 6 369×905 @2.625 0/0 r30 phone",
      "Galaxy Z Flip 6 412×1005 @2.625 0/0 r30 phone",
      "Pixel 9 Pro Fold 411×923 @2.625 0/0 r30 phone",
      "iPhone Duo 466×678 @3 0/0 r40 phone",
      "iPad mini 7 744×1133 @2 0/0 r18 tablet",
      'iPad Air 11" 820×1180 @2 0/0 r18 tablet',
      "Desktop 1440×900 @1 0/0 r0 desktop"
    ]);
  });

  it("marks the presets with estimated sizes or safe insets approx and only those", () => {
    expect(DEVICES.filter(device => device.approx === true).map(device => device.id)).toEqual([
      "iphone-17e",
      "iphone-air",
      "iphone-18-pro",
      "iphone-18-pro-max",
      "redmi-note-13",
      "galaxy-z-fold-6",
      "pixel-9-pro-fold",
      "iphone-duo"
    ]);
  });

  it("gives the SE 3 the home-button frame and every other preset the modern one (R9)", () => {
    expect(
      DEVICES.filter(device => device.frame === "home-button").map(device => device.id)
    ).toEqual(["iphone-se"]);
    expect(DEVICES.filter(device => device.frame !== "modern")).toHaveLength(1);
  });

  it("gives the three book foldables a cover and an inner screen; the top-level size is the cover", () => {
    const foldables = DEVICES.filter(device => device.fold !== undefined);
    expect(foldables.map(device => device.id)).toEqual([
      "galaxy-z-fold-6",
      "pixel-9-pro-fold",
      "iphone-duo"
    ]);
    expect(deviceById("galaxy-z-fold-6")?.fold).toEqual({
      cover: { w: 369, h: 905, radius: 30 },
      inner: { w: 707, h: 823, radius: 30 }
    });
    expect(deviceById("pixel-9-pro-fold")?.fold).toEqual({
      cover: { w: 411, h: 923, radius: 30 },
      inner: { w: 791, h: 820, radius: 30 }
    });
    expect(deviceById("iphone-duo")?.fold).toEqual({
      cover: { w: 466, h: 678, radius: 40 },
      inner: { w: 890, h: 626, radius: 40 }
    });
    for (const device of foldables) {
      expect({ w: device.w, h: device.h, radius: device.radius }).toEqual(device.fold?.cover);
    }
  });

  it("has unique ids, and a known group for every preset", () => {
    expect(new Set(DEVICES.map(device => device.id)).size).toBe(DEVICES.length);
    const groups = new Set(DEVICE_GROUPS.map(group => group.id));
    for (const device of DEVICES) expect(groups.has(device.group)).toBe(true);
  });

  it("finds a preset by id and rejects unknown ids", () => {
    expect(deviceById("pixel-8")?.dpr).toBe(2.625);
    expect(deviceById("nokia")).toBeUndefined();
    expect(isDevicePresetId("ipad-mini")).toBe(true);
    expect(isDevicePresetId("galaxy-z-fold-6")).toBe(true);
    expect(isDevicePresetId("iphone-18-pro")).toBe(true);
    expect(isDevicePresetId("nokia")).toBe(false);
    expect(isDevicePresetId(3)).toBe(false);
  });

  it("keeps the earlier iPhone ids a viewer may have stored", () => {
    for (const id of ["iphone-15", "iphone-15-pro-max", "iphone-16-pro", "iphone-16-pro-max"]) {
      expect(isDevicePresetId(id)).toBe(true);
    }
  });
});

describe("DEFAULT_DEVICE", () => {
  it("is the iPhone 18 Pro, which an unknown id falls back to too", () => {
    expect(DEFAULT_DEVICE).toBe("iphone-18-pro");
    expect(presetOf("nokia").id).toBe("iphone-18-pro");
    expect(presetOf(DEFAULT_DEVICE).name).toBe("iPhone 18 Pro");
  });
});

describe("DEVICE_GROUPS", () => {
  it("names the optgroups in display order", () => {
    expect(DEVICE_GROUPS).toEqual([
      { id: "iphone", label: "iPhone" },
      { id: "android", label: "Android" },
      { id: "foldable", label: "Foldable" },
      { id: "tablet", label: "Tablet" },
      { id: "desktop", label: "Desktop" }
    ]);
  });
});

describe("screenOf", () => {
  it("a foldable shows its cover folded and its inner screen unfolded", () => {
    const fold = presetOf("galaxy-z-fold-6");
    expect(screenOf(fold, true)).toBe(fold);
    expect(screenOf(fold, false)).toMatchObject({
      id: "galaxy-z-fold-6",
      w: 707,
      h: 823,
      radius: 30,
      fold: fold.fold
    });
  });

  it("any other preset is itself either way", () => {
    const iphone = presetOf("iphone-15");
    expect(screenOf(iphone, false)).toBe(iphone);
    expect(screenOf(iphone, true)).toBe(iphone);
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

  it("an unfolded foldable resolves the inner screen", () => {
    const inner = screenOf(presetOf("galaxy-z-fold-6"), false);
    expect(resolveDevice(inner, "portrait")).toMatchObject({ w: 707, h: 823 });
    expect(resolveDevice(inner, "landscape")).toMatchObject({ w: 823, h: 707 });
  });
});

describe("device types", () => {
  it("types the preset id, the orientation and the resolved size", () => {
    expectTypeOf(DEFAULT_DEVICE).toEqualTypeOf<DevicePresetId>();
    expectTypeOf<Orientation>().toEqualTypeOf<"portrait" | "landscape">();
    expectTypeOf(resolveDevice).returns.toEqualTypeOf<DeviceSize>();
    expect(isDevicePresetId(DEFAULT_DEVICE)).toBe(true);
  });
});
