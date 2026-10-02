/**
 * @file consoleView plugin — state factory.
 */
import type { Config, ConsoleState } from "./types";

/**
 * Creates the initial console state: no lines, nextKey 1, preserve from config, level "all".
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @example
 * ```ts
 * createConsoleState({ config }).level; // "all"
 * ```
 */
export function createConsoleState(_ctx: { readonly config: Readonly<Config> }): ConsoleState {
  throw new Error("not implemented");
}
