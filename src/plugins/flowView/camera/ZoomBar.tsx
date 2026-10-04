/**
 * @file flowView camera module — the zoom bar (B6), bottom-left: −, the readout `NN %` (a click is
 * 100 %), +, Fit all, Fit selection.
 */
import type { VNode } from "preact";
import { Icon } from "../../panels/shared/icons";
import type { FlowActions, FlowCtx } from "../types";
import { useFlowStore } from "../useFlowStore";

/**
 * Props of `ZoomBar`.
 */
export type ZoomBarProps = { readonly ctx: FlowCtx; readonly actions: FlowActions };

/**
 * The zoom bar.
 *
 * @param props - Context and actions.
 * @returns The bar.
 */
export function ZoomBar(props: ZoomBarProps): VNode {
  const { ctx, actions } = props;
  const z = useFlowStore(ctx, state => state.camera.cam.z, "camera");
  return (
    <div data-flow="zoom-bar" data-chrome="" role="toolbar" aria-label="Zoom">
      <button
        type="button"
        data-action="zoom-out"
        aria-label="Zoom out"
        onClick={() => actions.camera.zoomBy(0.8)}
      >
        <Icon name="zoom-out" />
      </button>
      <button
        type="button"
        data-action="readout"
        title="Zoom to 100 %"
        onClick={() => actions.camera.zoomTo(1)}
      >
        {`${Math.round(z * 100)} %`}
      </button>
      <button
        type="button"
        data-action="zoom-in"
        aria-label="Zoom in"
        onClick={() => actions.camera.zoomBy(1.25)}
      >
        <Icon name="zoom-in" />
      </button>
      <button type="button" data-action="fit-all" onClick={() => actions.camera.fitAll()}>
        <Icon name="fit-all" />
        Fit all
      </button>
      <button
        type="button"
        data-action="fit-selection"
        onClick={() => actions.camera.fitSelection()}
      >
        <Icon name="fit-selection" />
        Fit selection
      </button>
    </div>
  );
}
