/**
 * @file filesView plugin — the view change fan-out: every domain change calls `notify`, the
 * view and `api.subscribe` listeners re-read the state.
 */
import type { FilesViewState } from "./types";

/**
 * Calls every listener once (over a copy, so a listener may unsubscribe while it runs).
 *
 * @param state - filesView state.
 * @example
 * ```ts
 * tab.buffer = text;
 * notify(ctx.state);
 * ```
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
 * @example
 * ```ts
 * const off = subscribe(ctx.state, redraw);
 * ```
 */
export function subscribe(state: FilesViewState, fn: () => void): () => void {
  /**
   *
   * @example
   */
  /**
   * A listener of its own, so the same function subscribed twice unsubscribes once each.
   *
   * @example
   * ```ts
   * listener(); // calls fn
   * ```
   */
  const listener = (): void => {
    fn();
  };
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}
