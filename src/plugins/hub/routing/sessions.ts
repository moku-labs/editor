/**
 * @file hub plugin — routing/sessions.ts (skeleton stubs, implemented in its wave).
 */
import type { Manifest, SessionInfo } from "../../registry/protocol";
import type { AgentConn, HubCtx, Session } from "../types";

/**
 * Skeleton stub for `openSession`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _conn - The conn.
 * @param _manifest - The manifest.
 * @example
 * ```ts
 * openSession();
 * ```
 */
export function openSession(_ctx: HubCtx, _conn: AgentConn, _manifest: Manifest): Session {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `closeSession`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _id - The id.
 * @param _reason - The reason.
 * @example
 * ```ts
 * closeSession();
 * ```
 */
export function closeSession(_ctx: HubCtx, _id: string, _reason: "bye" | "game_reloaded"): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `chooseSession`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _requested - The requested.
 * @example
 * ```ts
 * chooseSession();
 * ```
 */
export function chooseSession(_ctx: HubCtx, _requested: string | undefined): Session {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `toSessionInfo`; implemented in its wave.
 *
 * @param _session - The session.
 * @example
 * ```ts
 * toSessionInfo();
 * ```
 */
export function toSessionInfo(_session: Session): SessionInfo {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `tickSilent`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _now - The now.
 * @example
 * ```ts
 * tickSilent();
 * ```
 */
export function tickSilent(_ctx: HubCtx, _now: number): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `isManifest`; implemented in its wave.
 *
 * @param _value - The value.
 * @example
 * ```ts
 * isManifest();
 * ```
 */
export function isManifest(_value: unknown): _value is Manifest {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `broadcastSessions`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * broadcastSessions();
 * ```
 */
export function broadcastSessions(_ctx: HubCtx): void {
  throw new Error("not implemented");
}
