/**
 * @file stateView plugin — the State panel: sources game.model, game.position,
 * game.history {last: 1}; the view reads the values and the tracker api.
 */
import type { PanelSpec } from "../panels/types";
import type { StateViewCtx } from "./types";

/**
 * The State panel definition.
 *
 * @param _ctx - Domain context of stateView.
 * @example
 * ```ts
 * ctx.require(panelsPlugin).register(createStatePanel(ctx));
 * ```
 */
export function createStatePanel(_ctx: StateViewCtx): PanelSpec {
  throw new Error("not implemented");
}
