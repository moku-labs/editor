/**
 * @file link plugin — status/machine.ts (skeleton stubs, implemented in its wave).
 */
import type { LinkStatus } from "../../registry/protocol";
import type { LinkCtx, StatusInput } from "../types";

/**
 * Skeleton stub for `nextStatus`; implemented in its wave.
 *
 * @param _current - The current.
 * @param _input - The input.
 * @param _now - The now.
 * @example
 * ```ts
 * nextStatus();
 * ```
 */
export function nextStatus(_current: LinkStatus, _input: StatusInput, _now: number): LinkStatus {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `setStatus`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _next - The next.
 * @example
 * ```ts
 * setStatus();
 * ```
 */
export function setStatus(_ctx: LinkCtx, _next: LinkStatus): void {
  throw new Error("not implemented");
}
