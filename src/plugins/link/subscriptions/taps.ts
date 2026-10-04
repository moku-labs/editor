/**
 * @file link plugin — the tap listeners: every tap of the chosen session goes to each one.
 */
import type { Tap } from "../../registry/protocol";
import type { LinkCtx } from "../types";

/**
 * Adds a tap listener.
 *
 * @param ctx - Domain context of link.
 * @param listener - Called with each tap.
 * @returns An idempotent unsubscribe.
 */
export function addTapListener(ctx: LinkCtx, listener: (tap: Tap) => void): () => void {
  const { tapListeners } = ctx.state;
  /**
   * A wrapper of `listener`, so the same function added twice gets two independent entries.
   *
   * @param tap - The tap to pass on.
   */
  const entry = (tap: Tap): void => {
    listener(tap);
  };

  tapListeners.add(entry);
  return () => {
    tapListeners.delete(entry);
  };
}

/**
 * Gives one frozen tap to every listener in subscription order; a listener that throws is logged
 * and the others still run.
 *
 * @param ctx - Domain context of link.
 * @param tap - The tap of the chosen session.
 */
export function notifyTap(ctx: LinkCtx, tap: Tap): void {
  const frozen = Object.freeze({ x: tap.x, y: tap.y, at: tap.at });
  for (const listener of ctx.state.tapListeners) {
    try {
      listener(frozen);
    } catch (error) {
      ctx.log.error("link:tap-listener-failed", {}, error instanceof Error ? error : undefined);
    }
  }
}
