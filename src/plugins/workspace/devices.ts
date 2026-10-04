/**
 * @file workspace plugin — the device presets (DeviceSpec, R1; round 2 R4 from
 * `.planning/build/research-devices.md`; round 2b R10 adds the current iPhones and the iPhone
 * Duo from the apple.com specs of 2026-10-04) in display order, their `<optgroup>` groups, and
 * the pure rules: resolveDevice (landscape swaps W and H; safe left = right = safeTop, bottom =
 * safeBottom) and screenOf (a foldable shows its cover folded, its inner screen unfolded).
 * gameView imports them by relative path (R8).
 *
 * Sizes are the full-screen portrait viewport in CSS px. Every corner radius is an estimate from
 * device photos (a real-device check is open); `approx: true` marks the presets whose size or
 * safe insets are estimates too, not published figures. `frame` is the bezel gameView draws (R9):
 * only the SE 3 has the home-button frame.
 */
import type { DeviceSpec } from "../registry/protocol";
import type { DeviceChoice, DevicePresetId, DeviceSize, Orientation, StoredDevice } from "./types";

/**
 * The default preset (and the fallback of an unknown id).
 */
const IPHONE_18_PRO: DeviceSpec = {
  id: "iphone-18-pro",
  name: "iPhone 18 Pro",
  // approx: safe insets and radius taken from the iPhone 16 Pro, the same screen
  w: 402,
  h: 874,
  dpr: 3,
  safeTop: 62,
  safeBottom: 34,
  radius: 62,
  kind: "phone",
  group: "iphone",
  frame: "modern",
  approx: true
};

/**
 * The twenty-one presets in display order: iPhone, Android, Foldable, Tablet, Desktop. In the
 * iPhone group the SE 3 and the iPhone 15 come first, then the current models; the 15 Pro Max,
 * 16 Pro and 16 Pro Max stay at the end because viewers may have them stored. Android, foldable
 * and tablet browsers report no safe insets (research table).
 *
 * @example
 * ```ts
 * DEVICES.find(device => device.id === "pixel-8")?.dpr; // 2.625
 * ```
 */
export const DEVICES: readonly DeviceSpec[] = [
  // iPhone
  {
    id: "iphone-se",
    name: "iPhone SE 3 · small, 2022",
    w: 375,
    h: 667,
    dpr: 2,
    safeTop: 20,
    safeBottom: 0,
    radius: 0,
    kind: "phone",
    group: "iphone",
    frame: "home-button"
  },
  {
    id: "iphone-15",
    name: "iPhone 15",
    w: 393,
    h: 852,
    dpr: 3,
    safeTop: 59,
    safeBottom: 34,
    radius: 55,
    kind: "phone",
    group: "iphone",
    frame: "modern"
  },
  {
    id: "iphone-17e",
    name: "iPhone 17e",
    // approx: a notch, not an island; safe insets and radius estimated
    w: 390,
    h: 844,
    dpr: 3,
    safeTop: 47,
    safeBottom: 34,
    radius: 47,
    kind: "phone",
    group: "iphone",
    frame: "modern",
    approx: true
  },
  {
    id: "iphone-air",
    name: "iPhone Air",
    // approx: safe insets and radius estimated
    w: 420,
    h: 912,
    dpr: 3,
    safeTop: 68,
    safeBottom: 34,
    radius: 62,
    kind: "phone",
    group: "iphone",
    frame: "modern",
    approx: true
  },
  IPHONE_18_PRO,
  {
    id: "iphone-18-pro-max",
    name: "iPhone 18 Pro Max",
    // approx: safe insets and radius taken from the iPhone 16 Pro Max, the same screen
    w: 440,
    h: 956,
    dpr: 3,
    safeTop: 62,
    safeBottom: 34,
    radius: 62,
    kind: "phone",
    group: "iphone",
    frame: "modern",
    approx: true
  },
  {
    id: "iphone-15-pro-max",
    name: "iPhone 15 Pro Max",
    w: 430,
    h: 932,
    dpr: 3,
    safeTop: 59,
    safeBottom: 34,
    radius: 55,
    kind: "phone",
    group: "iphone",
    frame: "modern"
  },
  {
    id: "iphone-16-pro",
    name: "iPhone 16 Pro",
    w: 402,
    h: 874,
    dpr: 3,
    safeTop: 62,
    safeBottom: 34,
    radius: 62,
    kind: "phone",
    group: "iphone",
    frame: "modern"
  },
  {
    id: "iphone-16-pro-max",
    name: "iPhone 16 Pro Max",
    w: 440,
    h: 956,
    dpr: 3,
    safeTop: 62,
    safeBottom: 34,
    radius: 62,
    kind: "phone",
    group: "iphone",
    frame: "modern"
  },

  // Android
  {
    id: "galaxy-s24",
    name: "Galaxy S24",
    w: 360,
    h: 780,
    dpr: 3,
    safeTop: 0,
    safeBottom: 0,
    radius: 40,
    kind: "phone",
    group: "android",
    frame: "modern"
  },
  {
    id: "galaxy-a55",
    name: "Galaxy A55",
    w: 412,
    h: 892,
    dpr: 2.625,
    safeTop: 0,
    safeBottom: 0,
    radius: 35,
    kind: "phone",
    group: "android",
    frame: "modern"
  },
  {
    id: "redmi-note-13",
    name: "Redmi Note 13",
    // approx: computed from the panel size and DPR, low confidence
    w: 393,
    h: 873,
    dpr: 2.75,
    safeTop: 0,
    safeBottom: 0,
    radius: 35,
    kind: "phone",
    group: "android",
    frame: "modern",
    approx: true
  },
  {
    id: "pixel-8",
    name: "Pixel 8",
    w: 412,
    h: 915,
    dpr: 2.625,
    safeTop: 0,
    safeBottom: 0,
    radius: 35,
    kind: "phone",
    group: "android",
    frame: "modern"
  },
  {
    id: "xperia-1-v",
    name: "Xperia 1 V 21:9",
    w: 411,
    h: 960,
    dpr: 4,
    safeTop: 0,
    safeBottom: 0,
    radius: 0,
    kind: "phone",
    group: "android",
    frame: "modern"
  },

  // Foldable: the top-level size is the cover screen (folded, the default)
  {
    id: "galaxy-z-fold-6",
    name: "Galaxy Z Fold 6",
    // approx: the cover screen is computed, low confidence; the inner one is medium-high
    w: 369,
    h: 905,
    dpr: 2.625,
    safeTop: 0,
    safeBottom: 0,
    radius: 30,
    kind: "phone",
    group: "foldable",
    frame: "modern",
    approx: true,
    fold: { cover: { w: 369, h: 905, radius: 30 }, inner: { w: 707, h: 823, radius: 30 } }
  },
  {
    id: "galaxy-z-flip-6",
    name: "Galaxy Z Flip 6",
    w: 412,
    h: 1005,
    dpr: 2.625,
    safeTop: 0,
    safeBottom: 0,
    radius: 30,
    kind: "phone",
    group: "foldable",
    frame: "modern"
  },
  {
    id: "pixel-9-pro-fold",
    name: "Pixel 9 Pro Fold",
    // approx: both screens computed from the panel sizes, low confidence
    w: 411,
    h: 923,
    dpr: 2.625,
    safeTop: 0,
    safeBottom: 0,
    radius: 30,
    kind: "phone",
    group: "foldable",
    frame: "modern",
    approx: true,
    fold: { cover: { w: 411, h: 923, radius: 30 }, inner: { w: 791, h: 820, radius: 30 } }
  },
  {
    id: "iphone-duo",
    name: "iPhone Duo",
    // approx: Apple publishes pixels only (1398×2034 cover, 2670×1878 inner), divided by 3 here;
    // a book that opens landscape-wide; radius estimated, safe insets unknown (0)
    w: 466,
    h: 678,
    dpr: 3,
    safeTop: 0,
    safeBottom: 0,
    radius: 40,
    kind: "phone",
    group: "foldable",
    frame: "modern",
    approx: true,
    fold: { cover: { w: 466, h: 678, radius: 40 }, inner: { w: 890, h: 626, radius: 40 } }
  },

  // Tablet
  {
    id: "ipad-mini",
    name: "iPad mini 7",
    w: 744,
    h: 1133,
    dpr: 2,
    safeTop: 0,
    safeBottom: 0,
    radius: 18,
    kind: "tablet",
    group: "tablet",
    frame: "modern"
  },
  {
    id: "ipad-air-11",
    name: 'iPad Air 11"',
    w: 820,
    h: 1180,
    dpr: 2,
    safeTop: 0,
    safeBottom: 0,
    radius: 18,
    kind: "tablet",
    group: "tablet",
    frame: "modern"
  },

  // Desktop
  {
    id: "desktop",
    name: "Desktop",
    w: 1440,
    h: 900,
    dpr: 1,
    safeTop: 0,
    safeBottom: 0,
    radius: 0,
    kind: "desktop",
    group: "desktop",
    frame: "modern"
  }
];

/**
 * The preset groups in display order with their `<optgroup>` labels.
 *
 * @example
 * ```ts
 * DEVICE_GROUPS.map(group => group.label); // ["iPhone", "Android", "Foldable", "Tablet", "Desktop"]
 * ```
 */
export const DEVICE_GROUPS: readonly {
  readonly id: DeviceSpec["group"];
  readonly label: string;
}[] = [
  { id: "iphone", label: "iPhone" },
  { id: "android", label: "Android" },
  { id: "foldable", label: "Foldable" },
  { id: "tablet", label: "Tablet" },
  { id: "desktop", label: "Desktop" }
];

/**
 * The preset a fresh viewer starts with.
 *
 * @example
 * ```ts
 * deviceById(DEFAULT_DEVICE)?.name; // "iPhone 18 Pro"
 * ```
 */
export const DEFAULT_DEVICE: DevicePresetId = "iphone-18-pro";

/**
 * Size and safe insets of a preset in an orientation. Portrait keeps W×H with the safe bands on
 * top and bottom; landscape swaps W and H, puts safeTop on the left and the right and keeps
 * safeBottom at the bottom (R8).
 *
 * @param preset - The device preset (for a foldable, its current screen: `screenOf`).
 * @param orientation - Portrait or landscape.
 * @returns The size in CSS px and the safe insets.
 * @example
 * ```ts
 * resolveDevice(presetOf("iphone-15"), "landscape"); // { w: 852, h: 393, safe: { top: 0, right: 59, bottom: 34, left: 59 } }
 * ```
 */
export function resolveDevice(preset: DeviceSpec, orientation: Orientation): DeviceSize {
  if (orientation === "portrait") {
    return {
      w: preset.w,
      h: preset.h,
      safe: { top: preset.safeTop, right: 0, bottom: preset.safeBottom, left: 0 }
    };
  }
  return {
    w: preset.h,
    h: preset.w,
    safe: { top: 0, right: preset.safeTop, bottom: preset.safeBottom, left: preset.safeTop }
  };
}

/**
 * The preset as it shows now: a foldable unfolded carries its inner screen's size and radius;
 * folded (and any other preset) it is the preset itself.
 *
 * @param preset - The device preset.
 * @param folded - Whether a foldable is folded (its cover screen).
 * @returns The DeviceSpec of the screen in use.
 * @example
 * ```ts
 * screenOf(presetOf("galaxy-z-fold-6"), false).w; // 707
 * screenOf(presetOf("galaxy-z-fold-6"), true).w; // 369
 * ```
 */
export function screenOf(preset: DeviceSpec, folded: boolean): DeviceSpec {
  if (preset.fold === undefined || folded) return preset;

  const { inner } = preset.fold;
  return { ...preset, w: inner.w, h: inner.h, radius: inner.radius };
}

/**
 * The preset with an id.
 *
 * @param id - A preset id.
 * @returns The DeviceSpec, undefined for an unknown id.
 * @example
 * ```ts
 * deviceById("pixel-8")?.w; // 412
 * ```
 */
export function deviceById(id: string): DeviceSpec | undefined {
  return DEVICES.find(device => device.id === id);
}

/**
 * The preset with an id, the default iPhone 18 Pro for an unknown one.
 *
 * @param id - A preset id.
 * @returns The DeviceSpec.
 * @example
 * ```ts
 * presetOf("pixel-8").name; // "Pixel 8"
 * presetOf("nokia").name; // "iPhone 18 Pro"
 * ```
 */
export function presetOf(id: string): DeviceSpec {
  return deviceById(id) ?? IPHONE_18_PRO;
}

/**
 * The device choice of a stored record: the screen in use, the orientation and the folded flag
 * (absent = folded).
 *
 * @param device - The stored device.
 * @returns The choice `device()` and `onPrefs` give.
 * @example
 * ```ts
 * deviceChoiceOf({ preset: "galaxy-z-fold-6", orientation: "portrait", folded: false }).preset.w; // 707
 * ```
 */
export function deviceChoiceOf(device: StoredDevice): DeviceChoice {
  const folded = device.folded ?? true;
  return {
    preset: screenOf(presetOf(device.preset), folded),
    orientation: device.orientation,
    folded
  };
}

/**
 * True for one of the preset ids.
 *
 * @param value - Anything (a stored value, an api argument).
 * @returns Whether it is a DevicePresetId.
 * @example
 * ```ts
 * isDevicePresetId("ipad-mini"); // true
 * ```
 */
export function isDevicePresetId(value: unknown): value is DevicePresetId {
  return DEVICES.some(device => device.id === value);
}
