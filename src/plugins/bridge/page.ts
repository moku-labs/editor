/**
 * @file bridge plugin — page behaviour: a `visibilitychange` (either way) sends one heartbeat in a
 * microtask, after the game's lifecycle listener has flipped the pause state.
 */
import { sendBeat } from "./connection/loop";
import type { BridgeDeps } from "./types";

/**
 * Listens to `visibilitychange` on the page document; while open, each event sends one heartbeat
 * in a microtask after it.
 *
 * @param deps - The domain deps.
 * @returns The remover (a no-op outside a browser).
 */
export function watchVisibility(deps: BridgeDeps): () => void {
  const doc = deps.page.document;
  if (doc === undefined) return () => {};

  /**
   * Queues one heartbeat after the event.
   */
  const onVisibility = (): void => {
    queueMicrotask(() => {
      if (deps.state.phase === "open") sendBeat(deps, deps.channel.heartbeat());
    });
  };
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
