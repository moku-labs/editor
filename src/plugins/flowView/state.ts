/**
 * @file flowView plugin — state factory and the view store: the composed module slices, plus
 * notify/subscribe for the Preact components (data changes) and the camera subscribers (camera
 * moves only; node cards never re-render on a camera change).
 */
import { createCameraState } from "./camera/state";
import { createFocusState } from "./focus/state";
import { createInspectorState } from "./inspector/state";
import { createLayoutState } from "./layout/state";
import { createNotesState } from "./notes/state";
import type { FlowViewConfig, FlowViewState } from "./types";

/**
 * Creates the composed flowView state.
 *
 * @param _ctx - Minimal context (the config is not needed: every slice starts empty).
 * @param _ctx.config - Resolved plugin config.
 * @returns The state.
 */
export function createFlowViewState(_ctx: {
  readonly config: Readonly<FlowViewConfig>;
}): FlowViewState {
  return {
    data: {
      graph: undefined,
      graphHash: "",
      position: undefined,
      history: [],
      status: { kind: "connecting" },
      stale: false,
      staleFrame: undefined,
      session: undefined,
      loaded: undefined
    },
    camera: createCameraState(),
    layout: createLayoutState(),
    focus: createFocusState(),
    notes: createNotesState(),
    inspector: createInspectorState(),
    view: {
      active: false,
      root: undefined,
      listeners: new Set(),
      cameraListeners: new Set(),
      revision: 0,
      timers: new Set(),
      files: undefined,
      removers: [],
      palette: { nodes: undefined, styles: undefined }
    }
  };
}

/**
 * Tells the components that data changed: bumps the revision, calls every data subscriber.
 *
 * @param state - The flowView state.
 */
export function notify(state: FlowViewState): void {
  state.view.revision += 1;
  for (const listener of state.view.listeners) listener();
}

/**
 * Tells the camera subscribers that the camera moved.
 *
 * @param state - The flowView state.
 */
export function notifyCamera(state: FlowViewState): void {
  for (const listener of state.view.cameraListeners) listener();
}

/**
 * Subscribes to data changes or camera moves.
 *
 * @param state - The flowView state.
 * @param listener - Called on every notify.
 * @param channel - "data" (default) or "camera".
 * @returns The unsubscribe function.
 */
export function subscribe(
  state: FlowViewState,
  listener: () => void,
  channel: "data" | "camera" = "data"
): () => void {
  const set = channel === "data" ? state.view.listeners : state.view.cameraListeners;
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
