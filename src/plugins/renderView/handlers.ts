/**
 * @file renderView plugin — hooks of the global tools events: workspace:changed starts and stops
 * the scene watches, link:status keeps or clears the session data, workspace:reveal reveals.
 */
import type { ToolsEvents } from "../../config";
import { highlightRef, revealRef, setTexturePalette } from "./actions";
import { removeOverlay } from "./overlay";
import { notify } from "./state";
import type { RenderViewCtx, RenderViewHooks, RenderViewState } from "./types";
import { refreshRenderView, startScene, stopScene } from "./watch";

/**
 * Forgets what belongs to one game session: FPS samples, the page heap, loaded bundles, the
 * release log, texture use, the first frame, the effects, the catalogue and the calibration (link
 * re-sends the watches, R4).
 *
 * @param state - renderView state.
 */
function clearSession(state: RenderViewState): void {
  state.fps = [];
  state.heap = undefined;
  state.loaded = new Map();
  state.releases = [];
  state.seen = new Map();
  state.firstFrame = undefined;
  state.effects = undefined;
  state.catalogue = undefined;
  state.calibration = undefined;
  state.calibrationAsked = false;
}

/**
 * Forgets every value (no game left): the session data, the last values, the scene and the box.
 *
 * @param state - renderView state.
 */
function clearAll(state: RenderViewState): void {
  clearSession(state);
  state.session = undefined;
  state.lastFrame = undefined;
  state.render = undefined;
  state.assets = undefined;
  state.scene = undefined;
  state.error = undefined;
  state.box = undefined;
  state.pendingReveal = undefined;
  removeOverlay(state);
}

/**
 * Render shown: scene watches on, refresh once per session (catalogue, calibration). Hidden:
 * scene watches off, box cleared.
 *
 * @param ctx - Domain context of renderView.
 * @returns The hook.
 */
export function onWorkspaceChanged(
  ctx: RenderViewCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  return ({ ws }) => {
    const { state } = ctx;
    if (ws === "render") {
      state.active = true;
      startScene(ctx);
      if (state.catalogue === undefined) void refreshRenderView(ctx);
    } else {
      state.active = false;
      stopScene(ctx);
      highlightRef(ctx);
    }
    notify(state);
  };
}

/**
 * Keeps the data while silent or lost (the host marks it stale); clears the session data after a
 * session change and refreshes while Render is shown; clears everything on empty.
 *
 * @param ctx - Domain context of renderView.
 * @returns The hook.
 */
export function onLinkStatus(ctx: RenderViewCtx): (payload: ToolsEvents["link:status"]) => void {
  return ({ status, session }) => {
    const { state } = ctx;
    if (status.kind === "empty") {
      clearAll(state);
      setTexturePalette(ctx);
      notify(state);
      return;
    }
    if (status.kind !== "live" && status.kind !== "paused") return;
    if (session === undefined || session === state.session) return;

    state.session = session;
    clearSession(state);
    setTexturePalette(ctx);
    notify(state);
    if (state.active) void refreshRenderView(ctx);
  };
}

/**
 * Reveals the element in the render tree (gameView's "Show in render tree").
 *
 * @param ctx - Domain context of renderView.
 * @returns The hook.
 */
export function onReveal(ctx: RenderViewCtx): (payload: ToolsEvents["workspace:reveal"]) => void {
  return ({ ref }) => revealRef(ctx, ref);
}

/**
 * renderView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of renderView.
 * @returns The three hooks.
 */
export function createHandlers(ctx: RenderViewCtx): RenderViewHooks {
  return {
    "workspace:changed": onWorkspaceChanged(ctx),
    "link:status": onLinkStatus(ctx),
    "workspace:reveal": onReveal(ctx)
  };
}
