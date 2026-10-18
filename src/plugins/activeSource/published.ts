/**
 * @file activeSource plugin — connect's published values (spec 11 § 4): each `editor.devices`
 * update gives the health ring one sample of the active device; an `editor.deviceTelemetry` record
 * reaches telemetry() and the onTelemetry listeners only when it is the active device's.
 */
import type { DeviceDirectory, DeviceTelemetry } from "../connect/protocol";
import { latencyOf, pushLatency } from "./health";
import type { ActiveSourceCtx } from "./types";

/**
 * A new device directory: one health sample of the active device (NaN for a gap).
 *
 * @param ctx - Domain context of activeSource.
 * @param directory - The directory connect published.
 */
export function handleDirectory(ctx: ActiveSourceCtx, directory: DeviceDirectory): void {
  const { state } = ctx;
  if (state.stopped || state.current.kind !== "device") return;
  pushLatency(state.health, latencyOf(directory, state.current.device.id));
}

/**
 * A new telemetry record: kept and passed to the onTelemetry listeners when it is the active
 * device's; a throwing listener is logged and the others still run.
 *
 * @param ctx - Domain context of activeSource.
 * @param record - The record connect published.
 */
export function handleTelemetry(ctx: ActiveSourceCtx, record: DeviceTelemetry): void {
  const { state } = ctx;
  const { current } = state;
  if (state.stopped || current.kind !== "device" || record.device !== current.device.id) return;

  state.telemetry = record;
  for (const listener of state.telemetryListeners) {
    try {
      listener(record);
    } catch (error) {
      ctx.log.error(
        "activeSource:telemetry-listener-failed",
        {},
        error instanceof Error ? error : undefined
      );
    }
  }
}
