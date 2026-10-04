/**
 * @file workspace plugin — the stored device record → the device choice `device()` and `onPrefs`
 * give. The presets and the pure rules (presetOf, screenOf, resolveDevice) live in the protocol
 * (registry/protocol/devices.ts), shared with gameView.
 */
import { presetOf, screenOf } from "../registry/protocol";
import type { DeviceChoice, StoredDevice } from "./types";

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
