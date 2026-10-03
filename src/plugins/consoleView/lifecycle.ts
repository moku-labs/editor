/**
 * @file consoleView plugin — onInit (register the Console panel), onStart (the game.log watch for
 * the session, palette items, the "/" binding, the badge) and onStop (drop them).
 */
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { clearConsole, setPreserve } from "./api";
import { pushBadge } from "./badge";
import { createConsolePanel } from "./panel";
import type { ConsoleCtx, ConsoleState } from "./types";
import { startLogWatch } from "./watch";

/**
 * Focuses the search field the Toolbar registered (the "/" binding).
 *
 * @param state - consoleView state.
 */
function focusSearch(state: ConsoleState): void {
  state.searchEl?.focus();
}

/**
 * Toggles Preserve log (the palette item).
 *
 * @param ctx - Domain context of consoleView.
 */
function togglePreserve(ctx: ConsoleCtx): void {
  setPreserve(ctx, !ctx.state.preserve);
}

/**
 * onInit: registers the Console panel, so the host knows every workspace before it mounts (D-04).
 *
 * @param ctx - Domain context of consoleView.
 */
export function registerConsolePanel(ctx: ConsoleCtx): void {
  ctx.require(panelsPlugin).register(createConsolePanel(ctx));
}

/**
 * onStart: watches game.log for the session, adds the palette items "Clear console" and
 * "Preserve log: on / off", binds "/" to the search field in Console, and clears a stale badge.
 *
 * @param ctx - Domain context of consoleView.
 */
export function startConsole(ctx: ConsoleCtx): void {
  const { state } = ctx;
  const workspace = ctx.require(workspacePlugin);

  state.stopLog = startLogWatch(ctx);
  state.removePalette.push(
    workspace.palette.add([
      {
        id: "console:clear",
        group: "Commands",
        label: "Clear console",
        run: clearConsole.bind(undefined, ctx)
      },
      {
        id: "console:preserve",
        group: "Commands",
        label: "Preserve log: on / off",
        run: togglePreserve.bind(undefined, ctx)
      }
    ]),
    workspace.keys.bind({
      keys: "/",
      label: "Search the log",
      workspace: "console",
      run: focusSearch.bind(undefined, state)
    })
  );
  pushBadge(ctx);
}

/**
 * onStop: drops the game.log watch, every palette item and key binding, and every view
 * listener. Teardown context only (spec/08 §4).
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopConsole(ctx: { readonly state: ConsoleState }): void {
  const { state } = ctx;
  const removers = state.removePalette;

  state.stopLog?.();
  state.stopLog = undefined;
  state.removePalette = [];
  for (const remove of removers) remove();
  state.listeners.clear();
  state.searchEl = undefined;
}
