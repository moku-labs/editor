/**
 * @file hub plugin — the paired devices of a device-mode run: their ids, the frozen copies the hub
 * reports (`LinkedDevice`, never the token) and the per-plugin event `hub:device`, which goes out
 * through `emitLogged` (a failing hook is logged `hub:emit-failed`, never thrown into a socket
 * handler).
 */
import { randomBytes } from "node:crypto";
import { emitLogged } from "../routing/sessions";
import type { DeviceRecord, HubCtx, HubDeviceEvent, HubState, LinkedDevice } from "../types";

/**
 * Four random hex digits.
 *
 * @returns e.g. "7f3a".
 * @example
 * ```ts
 * randomHex(); // "7f3a"
 * ```
 */
function randomHex(): string {
  return randomBytes(2).toString("hex");
}

/**
 * A free device id: `d-` and four hex digits, drawn again on collision (like session ids).
 *
 * @param taken - The paired devices.
 * @param nextHex - The hex source (random by default).
 * @returns The id.
 */
export function deviceIdFrom(
  taken: ReadonlyMap<string, unknown>,
  nextHex: () => string = randomHex
): string {
  let id = `d-${nextHex()}`;
  while (taken.has(id)) id = `d-${nextHex()}`;

  return id;
}

/**
 * The frozen report of a device record: its SessionDevice fields with the device listener's port,
 * when it paired and whether a connection is open now (a `closed` event passes `false`). Never the
 * token or the log indices.
 *
 * @param state - Hub state.
 * @param record - The device record.
 * @param online - Whether a connection is open; by default whether the record has one.
 * @returns A fresh frozen LinkedDevice.
 */
export function linkedDevice(
  state: HubState,
  record: DeviceRecord,
  online = record.conn !== undefined
): LinkedDevice {
  const { id, model, link, address, engine, build, pairedAt } = record;
  const port = state.deviceListen?.port ?? 0;

  return Object.freeze({
    id,
    model,
    link,
    address,
    port,
    engine,
    build,
    pairedAt,
    online
  });
}

/**
 * The paired devices ordered by pairedAt, as fresh frozen copies.
 *
 * @param state - Hub state.
 * @returns The devices; [] while device mode is off (the records die with it).
 */
export function devicesOf(state: HubState): LinkedDevice[] {
  return [...state.devices.values()]
    .toSorted((left, right) => left.pairedAt - right.pairedAt)
    .map(record => linkedDevice(state, record));
}

/**
 * Emits `hub:device` (not awaited; a throw or a rejected promise of the emit is logged).
 *
 * @param ctx - Domain context of the hub.
 * @param event - The event.
 */
export function emitDevice(ctx: HubCtx, event: HubDeviceEvent): void {
  emitLogged(
    () => ctx.emit("hub:device", event),
    error =>
      ctx.log.error("hub:emit-failed", {
        event: "hub:device",
        kind: event.kind,
        error: String(error)
      })
  );
}
