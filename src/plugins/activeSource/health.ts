/**
 * @file activeSource plugin — link health and the clock offset (spec 11 § 4 health,
 * clockOffsetMs): the latency ring of the active device (one sample per directory update, NaN for a
 * gap, allocated once) and the phone − computer offset of its heartbeats (link.onHeartbeat), the
 * median of the last 8.
 */
/* eslint-disable unicorn/no-null -- the spec's "no latency" and "no offset yet" */
import type { DeviceDirectory } from "../connect/protocol";
import type { ReceivedHeartbeat } from "../link/types";
import type { ActiveSourceCtx, ActiveSourceState } from "./types";

/**
 * Empties the health ring in place: every sample NaN, no latency.
 *
 * @param health - The ring of the state.
 */
export function resetHealth(health: ActiveSourceState["health"]): void {
  health.samples.fill(Number.NaN);
  health.head = 0;
  health.latencyMs = null;
}

/**
 * Writes the next sample of the ring: the latency, or NaN for a gap (no pong yet, the device away
 * or missing from the directory).
 *
 * @param health - The ring of the state.
 * @param latencyMs - The round trip in ms, or null.
 */
export function pushLatency(health: ActiveSourceState["health"], latencyMs: number | null): void {
  health.head = (health.head + 1) % health.samples.length;
  health.samples[health.head] = latencyMs ?? Number.NaN;
  health.latencyMs = latencyMs;
}

/**
 * The latency of a device in a directory: its linked entry's ping round trip while online, null
 * otherwise.
 *
 * @param directory - connect's directory.
 * @param device - The device id.
 * @returns The latency in ms, or null for a gap.
 * @example
 * ```ts
 * latencyOf({ v: 1, mode: { on: false, owner: null, listen: null }, confirmIn: null, adb: { available: true },
 *   wire: [], asking: [], linked: [], at: 1 }, "d-7f3a"); // null
 * ```
 */
export function latencyOf(directory: DeviceDirectory, device: string): number | null {
  const entry = directory.linked.find(linked => linked.id === device);
  return entry?.online === true ? entry.latencyMs : null;
}

/**
 * The clock offset one heartbeat gives: phone epoch − computer epoch, taking the beat as sent half a
 * ping round trip before it arrived.
 *
 * @param beatAt - `Heartbeat.at`, the phone's epoch ms.
 * @param receivedAt - The computer's epoch ms of arrival.
 * @param rttMs - The hub's ping round trip of the device.
 * @returns The offset in ms.
 * @example
 * ```ts
 * offsetOf(10_000, 10_420, 16); // -412: the phone's clock is 412 ms behind
 * ```
 */
export function offsetOf(beatAt: number, receivedAt: number, rttMs: number): number {
  return beatAt - (receivedAt - rttMs / 2);
}

/**
 * Keeps one offset in the ring of the last 8, overwriting the oldest.
 *
 * @param offsets - The offset ring of the state.
 * @param offset - The offset of one heartbeat.
 */
export function noteOffset(offsets: ActiveSourceState["offsets"], offset: number): void {
  offsets.values[offsets.head] = offset;
  offsets.head = (offsets.head + 1) % offsets.values.length;
  offsets.count = Math.min(offsets.count + 1, offsets.values.length);
}

/**
 * Empties the offset ring in place.
 *
 * @param offsets - The offset ring of the state.
 */
export function resetOffsets(offsets: ActiveSourceState["offsets"]): void {
  offsets.head = 0;
  offsets.count = 0;
}

/**
 * A heartbeat link received: when it is the active device's session, its offset (the beat's `at`
 * against its arrival, half the device's ping round trip earlier; 0 before the first pong) joins
 * the ring. The local preview, another page and another session's beat change nothing.
 *
 * @param ctx - Domain context of activeSource.
 * @param beat - The beat, from link.onHeartbeat.
 */
export function handleHeartbeat(ctx: ActiveSourceCtx, beat: ReceivedHeartbeat): void {
  const { state } = ctx;
  const { current } = state;
  if (state.stopped || current.kind !== "device" || current.session !== beat.session) return;

  noteOffset(state.offsets, offsetOf(beat.at, beat.receivedAt, state.health.latencyMs ?? 0));
}

/**
 * The median of the offsets kept: one late heartbeat does not move it.
 *
 * @param offsets - The offset ring of the state.
 * @returns The offset in ms, null before two beats.
 */
export function medianOffset(offsets: ActiveSourceState["offsets"]): number | null {
  if (offsets.count < 2) return null;
  const sorted = offsets.values.subarray(0, offsets.count).toSorted();
  const middle = sorted.length / 2;
  const upper = sorted[Math.floor(middle)] ?? Number.NaN;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? Number.NaN) + upper) / 2;
}
