/**
 * @file hub plugin — the device connections' open and close (C3, C4, C5). A stale token's socket is
 * closed 4401 `unpaired` at open, before any message, with nothing else. A token upgrade is paired
 * at open: the record follows the new connection, an older live one is closed 1001 `replaced`
 * (announced as `closed` with reason `replaced` before the new `connected`), and the computer's
 * engine is refreshed. A paired connection that closes is announced `closed` with reason `bye` or
 * `lost`; a pairing socket that closes aborts its question and announces nothing.
 */
import { refreshAndPublish } from "../engine";
import { DEVICE_UNPAIRED_CODE, DEVICE_UNPAIRED_REASON } from "../protocol";
import type { AgentConn, DeviceConn, HubCtx, HubSocket, HubSocketData } from "../types";
import { abortPairing, armPairDeadline, clearPairDeadline } from "./pairing";
import { emitDevice, linkedDevice } from "./records";

/**
 * Close code of a server-side end (a replaced connection).
 */
const GOING_AWAY = 1001;

/**
 * Closes the socket of a stale device token with 4401 `unpaired` (the bridge pairs again at once)
 * and logs it once, without the device id or the token. No connection is registered.
 *
 * @param ctx - Domain context of the hub.
 * @param ws - The socket.
 * @param device - The device data of the upgrade.
 */
export function closeUnpaired(
  ctx: HubCtx,
  ws: HubSocket,
  device: NonNullable<HubSocketData["device"]>
): void {
  ws.close(DEVICE_UNPAIRED_CODE, DEVICE_UNPAIRED_REASON);
  ctx.log.info("hub:device-unpaired", { address: device.address, link: device.link });
}

/**
 * Pairs a token upgrade at open: the record's connection, address and link follow the new socket,
 * an older live connection of the record is announced `closed` (`replaced`) and closed 1001
 * `replaced`, then `connected` is emitted and the engine refreshed. A record forgotten since the
 * upgrade (device mode stopped) closes the socket 4401.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The new agent connection.
 * @param device - Its device side.
 * @param id - The device id of the upgrade.
 */
function reconnect(ctx: HubCtx, conn: AgentConn, device: DeviceConn, id: string): void {
  const { state } = ctx;
  const record = state.devices.get(id);
  if (record === undefined) {
    conn.socket.close(DEVICE_UNPAIRED_CODE, DEVICE_UNPAIRED_REASON);
    return;
  }

  const older = record.conn === undefined ? undefined : state.conns.get(record.conn);
  // The replaced connection's report, taken before the record follows the new socket.
  const replaced = linkedDevice(state, record, false);
  device.id = id;
  record.conn = conn.conn;
  record.address = device.address;
  record.link = device.link;
  if (older?.kind === "agent" && older.device !== undefined) {
    older.device.ended = true;
    emitDevice(ctx, { kind: "closed", device: replaced, reason: "replaced" });
    older.socket.close(GOING_AWAY, "replaced");
  }
  emitDevice(ctx, { kind: "connected", device: linkedDevice(state, record) });
  void refreshAndPublish(ctx);
}

/**
 * Gives a new agent connection of a device listener its device side; a token upgrade is paired
 * at once.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The new agent connection.
 * @param data - The device data of the upgrade.
 */
export function openDevice(
  ctx: HubCtx,
  conn: AgentConn,
  data: NonNullable<HubSocketData["device"]>
): void {
  const device: DeviceConn = {
    link: data.link,
    address: data.address,
    id: undefined,
    ended: false,
    deadline: undefined
  };
  conn.device = device;
  if (data.id === undefined) armPairDeadline(conn, device);
  else reconnect(ctx, conn, device, data.id);
}

/**
 * A device connection closed: a pairing socket aborts its question; a paired one leaves its record
 * (the phone may come back with its token) and is announced `closed` with reason `bye` after a bye
 * notification, else `lost`. A replaced connection was announced already, and a record forgotten
 * by device mode off announces nothing.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param device - Its device side.
 */
export function closeDevice(ctx: HubCtx, conn: AgentConn, device: DeviceConn): void {
  clearPairDeadline(device);
  if (device.id === undefined) {
    abortPairing(ctx, conn.conn);
    return;
  }

  const record = ctx.state.devices.get(device.id);
  if (record === undefined || device.ended) return;

  if (record.conn === conn.conn) record.conn = undefined;
  emitDevice(ctx, {
    kind: "closed",
    device: linkedDevice(ctx.state, record),
    reason: conn.bye ? "bye" : "lost"
  });
}
