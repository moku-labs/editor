/**
 * @file hub plugin — security/guard.ts (skeleton stubs, implemented in its wave).
 */
import type { GuardMode, HubServer } from "../types";

/**
 * Skeleton stub for `guard`; implemented in its wave.
 *
 * @param _req - The req.
 * @param _server - The server.
 * @param _mode - The mode.
 * @param _allow - The allow.
 * @example
 * ```ts
 * guard();
 * ```
 */
export function guard(
  _req: Request,
  _server: HubServer,
  _mode: GuardMode,
  _allow: ReadonlySet<string>
): Response | undefined {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `allowedHosts`; implemented in its wave.
 *
 * @param _port - The port.
 * @example
 * ```ts
 * allowedHosts();
 * ```
 */
export function allowedHosts(_port: number): ReadonlySet<string> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `allowedOrigins`; implemented in its wave.
 *
 * @param _port - The port.
 * @param _allow - The allow.
 * @example
 * ```ts
 * allowedOrigins();
 * ```
 */
export function allowedOrigins(_port: number, _allow: ReadonlySet<string>): ReadonlySet<string> {
  throw new Error("not implemented");
}
