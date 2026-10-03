/**
 * @file filesView plugin — the view change fan-out: every domain change calls `notify`, the
 * view and `api.subscribe` listeners re-read the state.
 */
import type { FilesViewState } from "./types";

/**
 * Calls every listener once (over a copy, so a listener may unsubscribe while it runs).
 *
 * @param state - filesView state.
 */
export function notify(state: FilesViewState): void {
  for (const listener of state.listeners) listener();
}

/**
 * Adds a change listener.
 *
 * @param state - filesView state.
 * @param fn - Called after each change.
 * @returns An idempotent unsubscribe.
 */
export function subscribe(state: FilesViewState, fn: () => void): () => void {
  /**
   * A listener of its own, so the same function subscribed twice unsubscribes once each.
   */
  const listener = (): void => {
    fn();
  };
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}
