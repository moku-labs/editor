/**
 * @file renderView device strip — the Preact hook of the strip: re-renders the component on every
 * `notifyStrip` (a device value, the selection, the record, More, the 1 s clock) and returns what
 * it selects. The Render workspace around it does not re-render for those.
 */
import { useLayoutEffect, useState } from "preact/hooks";
import { subscribeStrip } from "../state";
import type { DeviceStripState } from "../types";

/**
 * Subscribes the component to the strip's own notifications and returns the selected value of
 * this render. A layout effect: a notification right after the first render is not lost.
 *
 * @param strip - The strip state.
 * @param select - Reads what the component shows.
 * @returns The selected value.
 */
export function useDeviceStrip<T>(strip: DeviceStripState, select: () => T): T {
  const [, setVersion] = useState(0);
  useLayoutEffect(() => subscribeStrip(strip, () => setVersion(version => version + 1)), [strip]);
  return select();
}
