/**
 * @file bridge plugin — the link status: what `status()` answers per phase, the device link of
 * device mode (`linkOf`), and `setStatus`, which publishes the global agent event `bridge:status`
 * when the kind, the session or the device link changes, and at most once per SEEN_EMIT_MS for
 * the computer's last sign alone.
 */
import type { DeviceLink } from "../hub/protocol";
import type { Heartbeat, LinkStatus } from "../registry/protocol";
import { linkModeOf } from "./connection/address";
import type { BridgeDeps, BridgeState } from "./types";
import { SEEN_EMIT_MS } from "./types";

/**
 * The status a heartbeat stands for: paused or live, with its frame.
 *
 * @param beat - A heartbeat of the channel.
 * @returns `{ kind: "paused" | "live", frame }`.
 * @example
 * ```ts
 * statusOfBeat({ frame: 1840, paused: true, at: 0 }); // { kind: "paused", frame: 1840 }
 * ```
 */
export function statusOfBeat(beat: Heartbeat): LinkStatus {
  return beat.paused ? { kind: "paused", frame: beat.frame } : { kind: "live", frame: beat.frame };
}

/**
 * The link status now: connecting before open, the channel heartbeat while open, the published
 * lost status while lost, and lost "stopped" after stop. Never `silent` or `empty` (tools-side).
 *
 * @param deps - The state and the channel.
 * @returns A fresh LinkStatus.
 */
export function currentStatus(deps: Pick<BridgeDeps, "state" | "channel">): LinkStatus {
  const { state } = deps;
  switch (state.phase) {
    case "open": {
      return statusOfBeat(deps.channel.heartbeat());
    }
    case "lost": {
      return { ...state.status };
    }
    case "stopped": {
      return { kind: "lost", reason: "stopped", lastFrame: state.lastFrame, retryInMs: 0 };
    }
    default: {
      return { kind: "connecting" };
    }
  }
}

/**
 * The device link of the state: undefined in page mode; in device mode the link mode, the
 * address, and the pairing code, the computer's engine and its last sign when there are some.
 *
 * @param state - The bridge state.
 * @returns A fresh DeviceLink, or undefined.
 */
export function linkOf(state: BridgeState): DeviceLink | undefined {
  const { address, pairing, editorEngine, seenAt } = state;
  if (state.mode !== "device" || address === undefined) return undefined;

  return {
    mode: linkModeOf(state.phase, address),
    address,
    ...(pairing === undefined ? {} : { pairing: { code: pairing.code } }),
    ...(editorEngine === undefined ? {} : { editorEngine }),
    ...(seenAt === undefined ? {} : { seenAt })
  };
}

/**
 * True when two links differ in what the overlay draws: mode, address, pairing code, engine.
 * The last sign alone is not a change (it has its own rate).
 *
 * @param before - The link the last event carried.
 * @param after - The link now.
 * @returns Whether to emit.
 * @example
 * ```ts
 * linkChanged({ mode: "lan", address: "192.168.1.5:47600" }, { mode: "none", address: "192.168.1.5:47600" }); // true
 * ```
 */
function linkChanged(before: DeviceLink | undefined, after: DeviceLink | undefined): boolean {
  if (before === undefined || after === undefined) return before !== after;
  return (
    before.mode !== after.mode ||
    before.address !== after.address ||
    before.pairing?.code !== after.pairing?.code ||
    before.editorEngine !== after.editorEngine
  );
}

/**
 * True while linked in device mode when the computer's last sign is at least SEEN_EMIT_MS newer
 * than the last event.
 *
 * @param state - The bridge state.
 * @returns Whether the last sign alone is worth an event.
 */
function seenDue(state: BridgeState): boolean {
  return (
    state.mode === "device" &&
    state.phase === "open" &&
    state.seenAt !== undefined &&
    state.seenAt - state.seenEmittedAt >= SEEN_EMIT_MS
  );
}

/**
 * Emits `bridge:status` with the stored status, the session when there is one and the link in
 * device mode (exactOptionalPropertyTypes: absent keys, never undefined).
 *
 * @param deps - The state and the emit.
 * @param link - The device link now.
 */
function publish(deps: Pick<BridgeDeps, "state" | "emit">, link: DeviceLink | undefined): void {
  const { state } = deps;
  state.emittedLink = link;
  if (link !== undefined) state.seenEmittedAt = Date.now();
  const { session } = state;
  deps.emit({
    status: { ...state.status },
    ...(session === undefined ? {} : { session }),
    ...(link === undefined ? {} : { link })
  });
}

/**
 * Stores the status and emits `bridge:status` when its kind differs from the stored one, when
 * `announce` says the session changed, when the device link changed, or for the computer's last
 * sign at most once per SEEN_EMIT_MS. A frame change alone does not emit.
 *
 * @param deps - The state and the emit of `bridge:status`.
 * @param next - The new status.
 * @param announce - Emit even when nothing else changed (the session changed, or the start).
 */
export function setStatus(
  deps: Pick<BridgeDeps, "state" | "emit">,
  next: LinkStatus,
  announce = false
): void {
  const { state } = deps;
  const link = linkOf(state);
  const changed =
    announce ||
    next.kind !== state.status.kind ||
    linkChanged(state.emittedLink, link) ||
    seenDue(state);
  state.status = next;
  if (changed) publish(deps, link);
}

/**
 * Records a sign of the computer (a message received) and publishes it when it is due.
 *
 * @param deps - The state and the emit.
 */
export function noteSeen(deps: Pick<BridgeDeps, "state" | "emit">): void {
  const { state } = deps;
  state.seenAt = Date.now();
  if (seenDue(state)) publish(deps, linkOf(state));
}
