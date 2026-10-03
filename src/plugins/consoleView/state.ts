/**
 * @file consoleView plugin — state factory and the view store (notify, subscribe).
 */
import type { Config, ConsoleState } from "./types";

/**
 * Creates the initial console state: no lines, nextKey 1, Preserve log from config, level "all",
 * an empty query, nothing consumed, every flag false and every optional undefined.
 *
 * @param ctx - Minimal context (spec/08 §2).
 * @param ctx.config - Resolved plugin config.
 * @returns The fresh state.
 */
export function createConsoleState(ctx: { readonly config: Readonly<Config> }): ConsoleState {
  return {
    lines: [],
    nextKey: 1,
    instance: undefined,
    session: undefined,
    consumed: 0,
    preserve: ctx.config.preserveLog,
    level: "all",
    query: "",
    selected: undefined,
    everConnected: false,
    listeners: new Set(),
    stopLog: undefined,
    removePalette: [],
    searchEl: undefined
  };
}

/**
 * Calls every view listener.
 *
 * @param state - consoleView state.
 */
export function notify(state: ConsoleState): void {
  for (const listener of state.listeners) listener();
}

/**
 * Adds a view listener; returns an idempotent remover.
 *
 * @param state - consoleView state.
 * @param fn - The listener.
 * @returns The remover.
 */
export function subscribe(state: ConsoleState, fn: () => void): () => void {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
}
