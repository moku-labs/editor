/**
 * @file workspace plugin — the device presets (DeviceSpec, R1) in display order and the pure
 * resolveDevice rule (landscape swaps W and H; safe left = right = safeTop, bottom = safeBottom).
 * gameView imports resolveDevice by relative path (R8).
 */
import type { DeviceSpec } from "../registry/protocol";
import type { DeviceSize, Orientation } from "./types";

/**
 * The six presets of design §8, in display order.
 */
export const DEVICES: readonly DeviceSpec[] = [
  { id: "iphone-se", name: "iPhone SE", w: 375, h: 667, safeTop: 20, safeBottom: 0, kind: "phone" },
  {
    id: "iphone-15",
    name: "iPhone 15",
    w: 393,
    h: 852,
    safeTop: 59,
    safeBottom: 34,
    kind: "phone"
  },
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
 * Size and safe insets of a preset in an orientation.
 *
 * @param _preset - The device preset.
 * @param _orientation - Portrait or landscape.
 * @example
 * ```ts
 * resolveDevice(DEVICES[1]!, "landscape"); // { w: 852, h: 393, safe: { top: 0, right: 59, bottom: 34, left: 59 } }
 * ```
 */
export function resolveDevice(_preset: DeviceSpec, _orientation: Orientation): DeviceSize {
  throw new Error("not implemented");
}
