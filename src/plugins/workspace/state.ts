/**
 * @file workspace plugin — state factory (MinimalContext: no DOM, no storage) and the cleanup
 * registry every listener, timer and observer goes through, so onStop can remove all of them.
 */
import { DEFAULT_DEVICE } from "../registry/protocol";
import type { PreviewPrefs, PreviewWorkspace, WorkspaceConfig, WorkspaceState } from "./types";
import { createUiStore } from "./ui/store";

/**
 * Preview preferences of a workspace nobody changed: shown, size S, bottom-right corner.
 *
 * @returns A fresh record.
 * @example
 * ```ts
 * defaultPreview(); // { visible: true, size: "S", corner: "bottom-right" }
 * ```
 */
export function defaultPreview(): PreviewPrefs {
  return { visible: true, size: "S", corner: "bottom-right" };
}

/**
 * Default preview preferences of every preview workspace.
 *
 * @returns A fresh record per workspace.
 * @example
 * ```ts
 * defaultPreviews().flow.size; // "S"
 * ```
 */
export function defaultPreviews(): Record<PreviewWorkspace, PreviewPrefs> {
  return {
    flow: defaultPreview(),
    render: defaultPreview(),
    state: defaultPreview(),
    files: defaultPreview(),
    console: defaultPreview()
  };
}

/**
 * Creates the initial workspace state: defaults, empty maps, the UiStore. Preferences are loaded
 * in onInit, listeners added in onStart, the shell and the frame layer created by mount.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns The state.
 */
export function createWorkspaceState(ctx: {
  readonly config: Readonly<WorkspaceConfig>;
}): WorkspaceState {
  return {
    active: ctx.config.defaultWorkspace,
    theme: { chosen: undefined, os: "light" },
    density: { chosen: "auto", applied: "comfortable" },
    previews: defaultPreviews(),
    device: { preset: DEFAULT_DEVICE, orientation: "portrait" },
    overlayInGame: false,
    reference: false,
    showTaps: true,
    muted: false,
    taps: [],
    link: { kind: "connecting" },
    shown: { game: undefined, session: undefined },
    everLive: false,
    badges: {},
    toasts: [],
    nextToastId: 1,
    palette: { open: false, query: "", index: 0, items: new Map() },
    keys: { bindings: [], escape: [] },
    popover: undefined,
    hotReloadNote: undefined,
    lastRestore: undefined,
    step: undefined,
    frame: {
      iframe: undefined,
      layer: undefined,
      box: undefined,
      overlay: undefined,
      stage: undefined,
      reload: undefined,
      zones: new Map(),
      previewBody: undefined
    },
    dom: { root: undefined, hosts: new Map(), cleanup: [] },
    listeners: new Set(),
    ui: createUiStore(),
    ticker: undefined,
    stopped: false
  };
}

/**
 * Registers a cleanup for onStop; the returned untrack removes it again without running it (for
 * a resource released earlier, like a finished reload wait).
 *
 * @param state - Workspace state.
 * @param cleanup - Removes a listener, a timer or an observer.
 * @returns Untrack.
 */
export function trackCleanup(state: WorkspaceState, cleanup: () => void): () => void {
  state.dom.cleanup.push(cleanup);
  return () => {
    const index = state.dom.cleanup.indexOf(cleanup);
    if (index !== -1) state.dom.cleanup.splice(index, 1);
  };
}
