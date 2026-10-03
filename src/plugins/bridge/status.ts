/**
 * @file bridge plugin — the link status: what `status()` answers per phase, and `setStatus`, which
 * publishes the global agent event `bridge:status` when the kind or the session changes.
 */
import type { Heartbeat, LinkStatus } from "../registry/protocol";
import type { BridgeDeps } from "./types";

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
 * Stores the status and emits `bridge:status` when its kind differs from the stored one, or
 * when `announce` says the session changed. A frame change alone does not emit. The payload
 * carries `session` only when there is one (exactOptionalPropertyTypes).
 *
 * @param deps - The state and the emit of `bridge:status`.
 * @param next - The new status.
 * @param announce - Emit even when the kind is the same (the session changed, or the start).
 */
export function setStatus(
  deps: Pick<BridgeDeps, "state" | "emit">,
  next: LinkStatus,
  announce = false
): void {
  const { state } = deps;
  const changed = announce || next.kind !== state.status.kind;
  state.status = next;
  if (!changed) return;

  const { session } = state;
  deps.emit(session === undefined ? { status: { ...next } } : { status: { ...next }, session });
}
