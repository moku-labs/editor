/**
 * @file renderView actions — the popovers of Mission control (spec 09 § M7): one open at a time
 * (Monitoring, Record, Connect, the split menu, the Memory breakdown); closing the Connect panel ends
 * its scan lease and its success alert.
 */
import type { MissionState } from "../types";

/** A popover of Mission control. */
export type PopoverId = NonNullable<MissionState["popover"]>;

/**
 * Closes the open popover; the Connect panel's scan lease stops and its alert timer is dropped.
 *
 * @param mission - Mission control's state.
 * @example
 * ```ts
 * closePopover(mission);
 * mission.popover; // undefined, and connect.stopScan ran
 * ```
 */
export function closePopover(mission: MissionState): void {
  const { connect } = mission;
  connect.stopScan?.();
  connect.stopScan = undefined;
  clearTimeout(connect.alertTimer);
  connect.alertTimer = undefined;
  connect.alert = undefined;
  connect.error = undefined;
  mission.popover = undefined;
}

/**
 * Opens a popover, closing the one open before (one at a time). The Connect panel opens with
 * `openConnect`, which also starts its scan lease.
 *
 * @param mission - Mission control's state.
 * @param id - The popover.
 * @example
 * ```ts
 * openPopover(mission, "monitoring");
 * mission.popover; // "monitoring"
 * ```
 */
export function openPopover(mission: MissionState, id: Exclude<PopoverId, "connect">): void {
  if (mission.popover !== id) closePopover(mission);
  mission.popover = id;
}
