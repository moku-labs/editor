/**
 * @file link plugin — the onSessions listeners (spec 11 § 5.2). After every `sessions`
 * notification is applied (the list stored, a lost choice dropped, the pick attached), each
 * listener gets the same frozen list. A socket close calls nobody: the list the hub sends after the
 * reconnect does. This is how a device linking or leaving reaches activeSource without link knowing
 * devices.
 */
import type { SessionInfo } from "../../registry/protocol";
import type { LinkCtx } from "../types";

/**
 * Gives an applied list, frozen, to every onSessions listener in subscription order. A listener
 * that throws is logged as `link:sessions-listener-failed` and the others still run.
 *
 * @param ctx - Domain context of link.
 * @param list - The list just applied.
 */
export function notifySessions(ctx: LinkCtx, list: readonly SessionInfo[]): void {
  const frozen = Object.freeze([...list]);

  for (const listener of ctx.state.sessionsListeners) {
    try {
      listener(frozen);
    } catch (error) {
      ctx.log.error(
        "link:sessions-listener-failed",
        {},
        error instanceof Error ? error : undefined
      );
    }
  }
}

/**
 * Adds an onSessions listener; it is not called at once.
 *
 * @param ctx - Domain context of link.
 * @param listener - Called with each applied list.
 * @returns An idempotent unsubscribe.
 */
export function addSessionsListener(
  ctx: LinkCtx,
  listener: (list: readonly SessionInfo[]) => void
): () => void {
  const { sessionsListeners } = ctx.state;
  /**
   * A wrapper of `listener`, so the same function added twice gets two independent entries.
   *
   * @param list - The list to pass on.
   */
  const entry = (list: readonly SessionInfo[]): void => {
    listener(list);
  };

  sessionsListeners.add(entry);
  return () => {
    sessionsListeners.delete(entry);
  };
}
