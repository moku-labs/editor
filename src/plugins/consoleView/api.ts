/**
 * @file consoleView plugin — api factory.
 */
import type { ConsoleApi, ConsoleCtx } from "./types";

/**
 * Creates the console api.
 *
 * @param _ctx - Domain context of consoleView.
 * @example
 * ```ts
 * createConsoleApi(ctx).focusFrame(1778);
 * ```
 */
export function createConsoleApi(_ctx: ConsoleCtx): ConsoleApi {
  throw new Error("not implemented");
}
