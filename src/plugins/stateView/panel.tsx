/**
 * @file stateView plugin — the State panel: sources game.model, game.position and game.history
 * {last: 1}; the view reads the values and the tracker api. game.graph and game.tainted are no
 * panel sources: the tracker owns them for the whole session (R6).
 */
import { definePanel } from "../panels/define";
import type { PanelSpec } from "../panels/types";
import { createStateViewApi } from "./api";
import type { StateViewCtx } from "./types";
import { StateView } from "./view/StateView";

/**
 * The State panel definition.
 *
 * @param ctx - Domain context of stateView.
 * @returns The frozen PanelSpec.
 * @example
 * ```ts
 * ctx.require(panelsPlugin).register(createStatePanel(ctx));
 * ```
 */
export function createStatePanel(ctx: StateViewCtx): PanelSpec {
  const api = createStateViewApi(ctx);
  return definePanel({
    id: "state",
    title: "State",
    workspace: "state",
    sources: {
      model: "game.model",
      position: "game.position",
      history: ["game.history", { last: 1 }]
    },
    /**
     * Renders the State workspace with the panel values and the link status of this render.
     *
     * @param values - model, position and history.
     * @param tools - The panel tools (only the status is read).
     * @returns The State workspace.
     * @example
     * ```ts
     * createStatePanel(ctx).view({ model, position, history }, tools);
     * ```
     */
    view: (values, tools) => (
      <StateView
        api={api}
        config={ctx.config}
        model={values.model}
        position={values.position}
        history={values.history}
        status={tools.status}
      />
    )
  });
}
