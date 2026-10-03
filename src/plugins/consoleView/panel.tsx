/**
 * @file consoleView plugin — the Console panel: no sources (the plugin watches game.log for the
 * whole session, so the badge and Preserve log work in every workspace).
 */
import { definePanel } from "../panels/define";
import type { PanelElement, PanelSpec, PanelTools } from "../panels/types";
import type { ConsoleCtx } from "./types";
import { ConsoleView } from "./view/ConsoleView";

/**
 * The view of the Console panel: the workspace with this render's link status.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The panel view.
 * @example
 * ```tsx
 * definePanel({ id: "console", title: "Console", workspace: "console", sources: {}, view: viewOf(ctx) });
 * ```
 */
function viewOf(
  ctx: ConsoleCtx
): (
  values: unknown,
  tools: Pick<PanelTools<Readonly<Record<never, string>>>, "status">
) => PanelElement {
  return (_values, tools) => <ConsoleView ctx={ctx} status={tools.status} />;
}

/**
 * The Console panel: `definePanel({ id: "console", title: "Console", workspace: "console", sources: {}, view })`.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The frozen panel spec.
 * @example
 * ```ts
 * ctx.require(panelsPlugin).register(createConsolePanel(ctx)); // app.panels.list() has "console"
 * ```
 */
export function createConsolePanel(ctx: ConsoleCtx): PanelSpec {
  return definePanel({
    id: "console",
    title: "Console",
    workspace: "console",
    sources: {},
    view: viewOf(ctx)
  });
}
