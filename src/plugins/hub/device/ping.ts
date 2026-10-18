/**
 * @file hub plugin — the device link latency (spec 11 § 5.1 H4). While device mode runs, every
 * paired device connection is pinged once a second with the send time as the payload; the pong
 * that echoes the payload of the connection's last ping sets the record's `latencyMs` (the last
 * value; null before the first pong). A WebView answers pings at the protocol level, so the phone
 * needs nothing. Bun's own keep-alive pongs carry another payload and are ignored. The interval is
 * unref'd and cleared by `teardownDevices`.
 */
import type { HubSocket, HubState } from "../types";

/**
 * The ping period, in ms.
 */
export const PING_EVERY_MS = 1000;

/**
 * Decoder of a pong payload.
 */
const DECODER = new TextDecoder();

/**
 * Pings every paired device connection whose socket can ping, and remembers the send time on the
 * connection. A ping no pong answered is replaced: its late pong no longer matches.
 *
 * @param state - Hub state.
 * @param now - Epoch ms of this tick.
 */
export function pingDevices(state: HubState, now: number): void {
  for (const conn of state.conns.values()) {
    if (conn.kind !== "agent" || conn.device?.id === undefined) continue;
    if (state.devices.get(conn.device.id)?.conn !== conn.conn) continue;
    if (conn.socket.ping === undefined) continue;

    conn.device.pingAt = now;
    conn.socket.ping(String(now));
  }
}

/**
 * A pong: when it carries the payload of its connection's last ping, the round trip becomes the
 * device record's `latencyMs` and the ping is answered. Any other pong changes nothing.
 *
 * @param state - Hub state.
 * @param ws - The socket the pong came on.
 * @param data - The pong payload.
 * @param now - Epoch ms of its arrival.
 */
export function onPong(state: HubState, ws: HubSocket, data: Uint8Array, now: number): void {
  const conn = state.conns.get(ws.data.conn);
  const device = conn?.kind === "agent" ? conn.device : undefined;
  if (device?.id === undefined || device.pingAt === undefined) return;
  if (DECODER.decode(data) !== String(device.pingAt)) return;

  const record = state.devices.get(device.id);
  if (record !== undefined) record.latencyMs = now - device.pingAt;
  device.pingAt = undefined;
}

/**
 * Starts the once-a-second ping of device mode (unref'd: it never keeps the process alive).
 *
 * @param state - Hub state.
 */
export function startPings(state: HubState): void {
  stopPings(state);
  const timer = setInterval(() => pingDevices(state, Date.now()), PING_EVERY_MS);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  state.pingTimer = timer;
}

/**
 * Stops the ping of device mode, if it runs.
 *
 * @param state - Hub state.
 */
export function stopPings(state: HubState): void {
  if (state.pingTimer !== undefined) clearInterval(state.pingTimer);
  state.pingTimer = undefined;
}
