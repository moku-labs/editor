/**
 * @file consoleView plugin — the Console panel: no sources (the plugin watches game.log for the
 * whole session, so the badge and Preserve log work in every workspace).
 */
import type { PanelSpec } from "../panels/types";
import type { ConsoleCtx } from "./types";

/**
 * The Console panel: `definePanel({ id: "console", title: "Console", workspace: "console", sources: {}, view })`.
 *
 * @param _ctx - Domain context of consoleView.
 * @example
 * ```ts
 * ctx.require(panelsPlugin).register(createConsolePanel(ctx));
 * ```
 */
export function createConsolePanel(_ctx: ConsoleCtx): PanelSpec {
  throw new Error("not implemented");
}
