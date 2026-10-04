/**
 * @file flowView plugin — the public api `{ camera, focus, flows, layout }`: the public members
 * picked from the module actions (the internal members stay off `app.flowView`).
 */
import { actionsOf } from "./actions";
import type { FlowCtx, FlowViewApi } from "./types";

/**
 * Creates the namespaced flowView api.
 *
 * @param ctx - Domain context of flowView.
 * @returns The FlowViewApi (`app.flowView`).
 */
export function createFlowViewApi(ctx: FlowCtx): FlowViewApi {
  const { camera, focus, flows, layout } = actionsOf(ctx);
  return {
    camera: {
      get: camera.get,
      fitAll: camera.fitAll,
      fitSelection: camera.fitSelection,
      zoomBy: camera.zoomBy,
      zoomTo: camera.zoomTo,
      follow: camera.follow
    },
    focus: {
      select: focus.select,
      selected: focus.selected,
      current: focus.current,
      walk: focus.walk,
      followEdge: focus.followEdge,
      focusFrame: focus.focusFrame,
      step: focus.step,
      history: focus.history
    },
    flows: { expand: flows.expand, collapse: flows.collapse, enter: flows.enter, up: flows.up },
    layout: { pinnedCount: layout.pinnedCount, reset: layout.reset }
  };
}
