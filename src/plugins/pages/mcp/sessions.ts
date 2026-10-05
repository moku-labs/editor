/**
 * @file pages/mcp — the session a game tool means (the hub rule: the asked one, else the only
 * one, else the one embedded session) and its liveness check (M7): a paused or hidden game gets a
 * clear message instead of a timeout.
 */
import { pickSession } from "../../registry/protocol";
import type { SessionView } from "./types";

/**
 * The session the hub would pick for a request, by the one protocol rule (`pickSession`): the
 * asked id, else the only session, else the only embedded one.
 *
 * @param sessions - The sessions now.
 * @param requested - The `session` argument, if any.
 * @returns The session, or undefined when none or several fit.
 * @example
 * ```ts
 * chooseSession([pageSession, paneSession]); // paneSession, the one embedded in the tools page
 * ```
 */
export function chooseSession(
  sessions: readonly SessionView[],
  requested?: string
): SessionView | undefined {
  return pickSession(sessions, requested);
}

/**
 * Why a picture cannot be taken now: the game is paused or its page is hidden (no heartbeat).
 * Unknown liveness (no heartbeat yet, or no single session) lets the call go ahead.
 *
 * @param sessions - The sessions now.
 * @param requested - The `session` argument, if any.
 * @returns The message, or undefined when the game runs or its state is unknown.
 * @example
 * ```ts
 * livenessProblem(hub.sessions(), undefined);
 * // "game paused or hidden at frame 1840 — bring the editor pane to front or resume"
 * ```
 */
export function livenessProblem(
  sessions: readonly SessionView[],
  requested: string | undefined
): string | undefined {
  const heartbeat = chooseSession(sessions, requested)?.heartbeat;
  if (heartbeat === undefined || (!heartbeat.paused && !heartbeat.silent)) return undefined;
  return `game paused or hidden at frame ${String(heartbeat.frame)} — bring the editor pane to front or resume`;
}
