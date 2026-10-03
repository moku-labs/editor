/**
 * @file workspace plugin — the device presets (DeviceSpec, R1) in display order and the pure
 * resolveDevice rule (landscape swaps W and H; safe left = right = safeTop, bottom = safeBottom).
 * gameView imports resolveDevice by relative path (R8).
 */
import type { DeviceSpec } from "../registry/protocol";
import type { DevicePresetId, DeviceSize, Orientation } from "./types";

/**
 * The default preset (and the fallback of an unknown id).
 */
const IPHONE_15: DeviceSpec = {
  id: "iphone-15",
  name: "iPhone 15",
  w: 393,
  h: 852,
  safeTop: 59,
  safeBottom: 34,
  kind: "phone"
};

/**
 * The six presets of design §8, in display order.
 */
export const DEVICES: readonly DeviceSpec[] = [
  { id: "iphone-se", name: "iPhone SE", w: 375, h: 667, safeTop: 20, safeBottom: 0, kind: "phone" },
  IPHONE_15,
  {
    id: "iphone-15-pro-max",
    name: "iPhone 15 Pro Max",
    w: 430,
    h: 932,
    safeTop: 59,
    safeBottom: 34,
    kind: "phone"
  },
  { id: "pixel-8", name: "Pixel 8", w: 412, h: 915, safeTop: 24, safeBottom: 16, kind: "phone" },
  {
    id: "ipad-mini",
    name: "iPad mini",
    w: 744,
    h: 1133,
    safeTop: 24,
    safeBottom: 20,
    kind: "tablet"
  },
  { id: "desktop", name: "Desktop", w: 1440, h: 900, safeTop: 0, safeBottom: 0, kind: "desktop" }
];

/**
 * The preset a fresh viewer starts with.
 *
 * @example
 * ```ts
 * deviceById(DEFAULT_DEVICE)?.name; // "iPhone 15"
 * ```
 */
export const DEFAULT_DEVICE: DevicePresetId = "iphone-15";

/**
 * Size and safe insets of a preset in an orientation. Portrait keeps W×H with the safe bands on
 * top and bottom; landscape swaps W and H, puts safeTop on the left and the right and keeps
 * safeBottom at the bottom (R8).
 *
 * @param preset - The device preset.
 * @param orientation - Portrait or landscape.
 * @returns The size in CSS px and the safe insets.
 * @example
 * ```ts
 * resolveDevice(DEVICES[1]!, "landscape"); // { w: 852, h: 393, safe: { top: 0, right: 59, bottom: 34, left: 59 } }
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
 * The preset with an id, the iPhone 15 for an unknown one.
 *
 * @param id - A preset id.
 * @returns The DeviceSpec.
 * @example
 * ```ts
 * presetOf("pixel-8").name; // "Pixel 8"
 * presetOf("nokia").name; // "iPhone 15"
 * ```
 */
export function presetOf(id: string): DeviceSpec {
  return deviceById(id) ?? IPHONE_15;
}

/**
 * True for one of the six preset ids.
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
