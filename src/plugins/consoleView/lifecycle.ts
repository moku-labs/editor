/**
 * @file consoleView plugin — onInit (register the Console panel), onStart (the game.log watch for
 * the session, palette items, the "/" binding, the badge) and onStop (drop them).
 */
import type { ConsoleCtx, ConsoleState } from "./types";

/**
 * onInit: panels.register(createConsolePanel(ctx)).
 *
 * @param _ctx - Domain context of consoleView.
 * @example
 * ```ts
 * createToolsPlugin("consoleView", { onInit: registerConsolePanel });
 * ```
 */
export function registerConsolePanel(_ctx: ConsoleCtx): void {
  throw new Error("not implemented");
}

/**
 * onStart: startLogWatch, palette items, the "/" key binding, pushBadge.
 *
 * @param _ctx - Domain context of consoleView.
 * @example
 * ```ts
 * createToolsPlugin("consoleView", { onStart: startConsole });
 * ```
 */
export function startConsole(_ctx: ConsoleCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: stopLog, every palette remover, listeners cleared.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("consoleView", { onStop: stopConsole });
 * ```
 */
export function stopConsole(_ctx: { readonly state: ConsoleState }): void {
  throw new Error("not implemented");
}
