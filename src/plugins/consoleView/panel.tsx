/**
 * @file consoleView plugin — the Console panel: no sources (the plugin watches game.log for the
 * whole session, so the badge and Preserve log work in every workspace).
 */
import { definePanel } from "../panels/shared/define";
import type { PanelElement, PanelSpec, PanelTools, PanelValues } from "../panels/types";
import type { ConsoleCtx } from "./types";
import { ConsoleView } from "./view/ConsoleView";

/**
 * The view of the Console panel: the workspace with this render's link status.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The panel view.
 */
function viewOf(
  ctx: ConsoleCtx
): (
  values: PanelValues<Readonly<Record<never, never>>>,
  tools: Pick<PanelTools<Readonly<Record<never, string>>>, "status">
) => PanelElement {
  return (_values, tools) => <ConsoleView ctx={ctx} status={tools.status} />;
}

/**
 * The Console panel: `definePanel({ id: "console", title: "Console", workspace: "console", sources: {}, view })`.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The frozen panel spec.
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
