/**
 * @file link plugin — the heartbeat listeners (spec 11 § 5.2 L10): every heartbeat of the chosen
 * session that carries its `at` goes to each one, with the time it arrived here. activeSource
 * estimates a device's clock offset from them.
 */
import type { LinkCtx, ReceivedHeartbeat } from "../types";

/**
 * Adds a heartbeat listener; it is not called at once.
 *
 * @param ctx - Domain context of link.
 * @param listener - Called with each beat.
 * @returns An idempotent unsubscribe.
 */
export function addHeartbeatListener(
  ctx: LinkCtx,
  listener: (beat: ReceivedHeartbeat) => void
): () => void {
  const { heartbeatListeners } = ctx.state;
  /**
   * A wrapper of `listener`, so the same function added twice gets two independent entries.
   *
   * @param beat - The beat to pass on.
   */
  const entry = (beat: ReceivedHeartbeat): void => {
    listener(beat);
  };

  heartbeatListeners.add(entry);
  return () => {
    heartbeatListeners.delete(entry);
  };
}

/**
 * Gives one frozen beat to every listener in subscription order; a listener that throws is logged
 * as `link:heartbeat-listener-failed` and the others still run.
 *
 * @param ctx - Domain context of link.
 * @param beat - The beat of the chosen session.
 */
export function notifyHeartbeat(ctx: LinkCtx, beat: ReceivedHeartbeat): void {
  const frozen = Object.freeze({ session: beat.session, at: beat.at, receivedAt: beat.receivedAt });
  for (const listener of ctx.state.heartbeatListeners) {
    try {
      listener(frozen);
    } catch (error) {
      ctx.log.error(
        "link:heartbeat-listener-failed",
        {},
        error instanceof Error ? error : undefined
      );
    }
  }
}
