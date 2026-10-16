/**
 * @file renderView plugin — the Preact hook of Mission control (spec 09 § M14): re-renders a
 * component on every `notifyMission(mission)` and returns what it selects. Mission control's own
 * store, so its 1 Hz values never re-render the scene cards.
 */
import { useLayoutEffect, useState } from "preact/hooks";
import { subscribeMission } from "../state";
import type { MissionState } from "../types";

/**
 * Subscribes the component to Mission control's state and returns the selected value of this
 * render. The subscription is a layout effect: it runs before paint, so a `notifyMission` right
 * after the first render is not lost.
 *
 * @param mission - Mission control's state.
 * @param select - Reads what the component shows.
 * @returns The selected value.
 */
export function useMission<T>(mission: MissionState, select: () => T): T {
  const [, setVersion] = useState(0);
  useLayoutEffect(
    () => subscribeMission(mission, () => setVersion(version => version + 1)),
    [mission]
  );
  return select();
}
