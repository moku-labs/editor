/**
 * @file link plugin — sessions/choose.ts (skeleton stubs, implemented in its wave).
 */

import type { SessionInfo } from "../../registry/protocol";
import type { LinkCtx } from "../types";

/**
 * Skeleton stub for `pickSession`; implemented in its wave.
 *
 * @param _list - The list.
 * @param _current - The current.
 * @param _sticky - The sticky.
 * @example
 * ```ts
 * pickSession();
 * ```
 */
export function pickSession(
  _list: readonly SessionInfo[],
  _current: string | undefined,
  _sticky: boolean
): string | undefined {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `applySessions`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _list - The list.
 * @example
 * ```ts
 * applySessions();
 * ```
 */
export function applySessions(_ctx: LinkCtx, _list: readonly SessionInfo[]): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `attach`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _sessionId - The sessionId.
 * @example
 * ```ts
 * attach();
 * ```
 */
export function attach(_ctx: LinkCtx, _sessionId: string): Promise<void> {
  throw new Error("not implemented");
}
