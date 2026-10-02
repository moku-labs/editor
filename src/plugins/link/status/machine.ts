/**
 * @file link plugin — the link status machine (design-context §6 B1, F3): the pure reducer and
 * the store-and-emit step that publishes the global `link:status`.
 */
import type { LinkStatus } from "../../registry/protocol";
import type { LinkCtx, StatusInput } from "../types";

/**
 * The frame of the last heartbeat a status carries (0 when none).
 *
 * @param status - A link status.
 * @returns `frame` of live/paused, `lastFrame` of silent/lost, else 0.
 * @example
 * ```ts
 * lastFrameOf({ kind: "live", frame: 1840 }); // 1840
 * ```
 */
export function lastFrameOf(status: LinkStatus): number {
  switch (status.kind) {
    case "live":
    case "paused": {
      return status.frame;
    }
    case "silent":
    case "lost": {
      return status.lastFrame;
    }
    default: {
      return 0;
    }
  }
}

/**
 * True for the states a heartbeat moves to live or paused.
 *
 * @param status - The current status.
 * @returns Whether a heartbeat applies.
 * @example
 * ```ts
 * beats({ kind: "silent", since: 0, lastFrame: 3 }); // true
 * ```
 */
function beats(status: LinkStatus): boolean {
  return status.kind !== "lost" && status.kind !== "empty";
}

/**
 * The pure reducer of the status table (05-link "Status machine"). An input that does not apply
 * returns `current` itself.
 *
 * @param current - The current status.
 * @param input - What happened.
 * @returns The next status.
 * @example
 * ```ts
 * nextStatus({ kind: "connecting" }, { type: "heartbeat", frame: 3, paused: false }); // { kind: "live", frame: 3 }
 * ```
 */
export function nextStatus(current: LinkStatus, input: StatusInput): LinkStatus {
  switch (input.type) {
    case "socket-open":
    case "attached": {
      return { kind: "connecting" };
    }
    case "socket-closed":
    case "session-closed": {
      const { reason, retryInMs } = input;
      return { kind: "lost", reason, lastFrame: lastFrameOf(current), retryInMs };
    }
    case "no-boot": {
      return { kind: "lost", reason: "no_boot", lastFrame: 0, retryInMs: 0 };
    }
    case "sessions": {
      const waiting = current.kind === "connecting" || current.kind === "empty";
      return waiting && input.count === 0 && !input.attached ? { kind: "empty" } : current;
    }
    case "heartbeat": {
      if (!beats(current)) return current;
      return { kind: input.paused ? "paused" : "live", frame: input.frame };
    }
    case "silence": {
      if (current.kind !== "live" && current.kind !== "paused") return current;
      return { kind: "silent", since: input.since, lastFrame: current.frame };
    }
    case "lost-expired": {
      return current.kind === "lost" ? { kind: "empty" } : current;
    }
  }
}

/**
 * True when two statuses carry the same kind and the same fields. Every status is a flat object
 * the reducer builds with a fixed key order per kind.
 *
 * @param left - One status.
 * @param right - The other.
 * @returns Whether nothing changed.
 * @example
 * ```ts
 * sameStatus({ kind: "live", frame: 1 }, { kind: "live", frame: 2 }); // false
 * ```
 */
function sameStatus(left: LinkStatus, right: LinkStatus): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Emits the global `link:status` with the current status and the chosen session.
 *
 * @param ctx - Domain context of link.
 * @example
 * ```ts
 * emitStatus(ctx); // after a session switch that kept the status kind
 * ```
 */
export function emitStatus(ctx: LinkCtx): void {
  const { status, chosen } = ctx.state;
  ctx.emit("link:status", chosen === undefined ? { status } : { status, session: chosen });
}

/**
 * Stores a status and emits `link:status` when its kind or a field changed.
 *
 * @param ctx - Domain context of link.
 * @param next - The new status.
 * @returns Whether it changed (and was emitted).
 * @example
 * ```ts
 * setStatus(ctx, { kind: "live", frame: 1840 });
 * ```
 */
export function setStatus(ctx: LinkCtx, next: LinkStatus): boolean {
  if (sameStatus(ctx.state.status, next)) return false;

  ctx.state.status = next;
  emitStatus(ctx);
  return true;
}

/**
 * Runs the reducer on the current status and stores the result.
 *
 * @param ctx - Domain context of link.
 * @param input - What happened.
 * @returns Whether the status changed.
 * @example
 * ```ts
 * applyStatus(ctx, { type: "socket-open" });
 * ```
 */
export function applyStatus(ctx: LinkCtx, input: StatusInput): boolean {
  return setStatus(ctx, nextStatus(ctx.state.status, input));
}
