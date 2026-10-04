/**
 * @file renderView plugin — state factory and the UI store (notify, subscribe).
 */
import type { RenderViewConfig, RenderViewState } from "./types";

/**
 * Creates the initial renderView state: textures sorted by GPU MB descending, every bundle shown,
 * no data. The roots of the tree open on the first scene of a session.
 *
 * @param _ctx - Minimal context (the config shapes nothing here yet).
 * @param _ctx.config - Resolved plugin config.
 * @returns The fresh state.
 */
export function createRenderViewState(_ctx: {
  readonly config: Readonly<RenderViewConfig>;
}): RenderViewState {
  return {
    active: false,
    session: undefined,
    lastFrame: undefined,
    firstFrame: undefined,
    render: undefined,
    assets: undefined,
    effects: undefined,
    effectsWatch: undefined,
    effectsInstalled: true,
    sources: {},
    scene: undefined,
    calibration: undefined,
    calibrationAsked: false,
    catalogue: undefined,
    fps: [],
    heap: undefined,
    loaded: new Map(),
    releases: [],
    seen: new Map(),
    tree: { open: new Set(), selected: undefined },
    table: { sort: "gpuMb", dir: -1, bundle: "all", hover: undefined },
    pendingReveal: undefined,
    box: undefined,
    overlayRoot: undefined,
    error: undefined,
    palette: undefined,
    tracker: [],
    watching: [],
    listeners: new Set()
  };
}

/**
 * Calls every UI listener.
 *
 * @param state - renderView state.
 */
export function notify(state: RenderViewState): void {
  for (const listener of state.listeners) listener();
}

/**
 * Adds a UI listener; returns an idempotent remover.
 *
 * @param state - renderView state.
 * @param fn - The listener.
 * @returns The remover.
 */
export function subscribe(state: RenderViewState, fn: () => void): () => void {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
}
