/**
 * @file renderView plugin — hooks of the global tools events and activeSource's per-plugin events:
 * workspace:changed starts and stops the scene watches and Mission control's watches and poll
 * (history kept), link:status keeps or clears the session data, link:project reads a stale catalogue
 * again, workspace:reveal reveals; `activeSource:changed` is Mission control's switch burst (with the
 * Connect panel's success alert), `activeSource:connect-requested` shows Render with its Connect
 * panel open.
 */
import type { ToolsEvents } from "../../config";
import { activeSourcePlugin } from "../activeSource";
import { workspacePlugin } from "../workspace";
import { highlightRef, revealRef, setTexturePalette } from "./actions";
import { openConnect } from "./actions/connect";
import { closePopover } from "./actions/popover";
import { connectedAlert } from "./derive/connect";
import { removeOverlay } from "./overlay";
import type { ConnectRequest, SourceChange } from "./source/contract";
import { startMission, stopMission, syncSource } from "./source/sync";
import { notify, notifyMission } from "./state";
import type { RenderViewCtx, RenderViewHooks, RenderViewState } from "./types";
import {
  isCatalogueStale,
  refreshRenderView,
  rereadCatalogue,
  startScene,
  stopScene
} from "./watch";

/**
 * Forgets what belongs to one game session: loaded bundles, the release log, texture use, the
 * first frame, the effects, the catalogue and the calibration (link re-sends the watches, R4).
 *
 * @param state - renderView state.
 */
function clearSession(state: RenderViewState): void {
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
 * Forgets every value (no game left): the session data, the last values, the scene, the effects
 * flag and the box.
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
  state.effectsInstalled = true;
  state.error = undefined;
  state.box = undefined;
  state.pendingReveal = undefined;
  removeOverlay(state);
}

/** How long the Connect panel shows its success alert before it closes, ms (spec 09 § M12). */
export const CONNECTED_CLOSE_MS = 1300;

/**
 * Render shown: scene watches on (none on a device source, R4), Mission control's watches and poll
 * on, refresh once per session (catalogue, calibration). Hidden: scene watches off, Mission control's
 * watches and poll off (the history is kept), the instrument's loop stopped, popovers closed, box
 * cleared.
 *
 * @param ctx - Domain context of renderView.
 * @returns The hook.
 */
export function onWorkspaceChanged(
  ctx: RenderViewCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  return ({ ws }) => {
    const { state } = ctx;
    const { mission } = state;
    if (ws === "render") {
      state.active = true;
      if (mission.source?.kind !== "device") startScene(ctx);
      startMission(ctx);
      if (state.catalogue === undefined) void refreshRenderView(ctx);
    } else {
      state.active = false;
      stopScene(ctx);
      stopMission(state);
      mission.stopLoop?.();
      mission.stopLoop = undefined;
      closePopover(mission);
      highlightRef(ctx);
    }
    notify(state);
    notifyMission(mission);
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
    if (status.kind === "silent" || status.kind === "lost") notifyMission(state.mission);
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
 * Reads the catalogue again when a project change made it stale: the first state after Render
 * read none, another manifest in the index, an edit of the manifest file, a gap.
 *
 * @param ctx - Domain context of renderView.
 * @returns The hook.
 */
export function onProject(ctx: RenderViewCtx): (payload: ToolsEvents["link:project"]) => void {
  return ({ state, delta }) => {
    if (!isCatalogueStale(ctx.state.catalogue, state, delta)) return;
    void rereadCatalogue(ctx);
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
 * The Connect panel's success alert of a switch to a device: the alert, one toast, and the panel
 * closes after CONNECTED_CLOSE_MS.
 *
 * @param ctx - Domain context of renderView.
 * @param name - The device's name.
 */
function showConnected(ctx: RenderViewCtx, name: string): void {
  const { mission } = ctx.state;
  const alert = connectedAlert(name);
  const { connect } = mission;
  clearTimeout(connect.alertTimer);
  connect.alert = name;
  connect.alertTimer = setTimeout(() => {
    connect.alertTimer = undefined;
    if (mission.popover === "connect") closePopover(mission);
    notifyMission(mission);
  }, CONNECTED_CLOSE_MS);
  ctx.require(workspacePlugin).toast(alert.toast);
}

/**
 * activeSource:changed: the switch burst (M2 rule 3); a switch to a device the person asked for
 * (connected, user) while the Connect panel is open keeps it for its success alert.
 *
 * @param ctx - Domain context of renderView.
 * @returns The hook.
 */
export function onSourceChanged(ctx: RenderViewCtx): (change: SourceChange) => void {
  return change => {
    const asked = change.reason === "connected" || change.reason === "user";
    const alert = asked && change.to.kind === "device" && ctx.state.mission.popover === "connect";
    syncSource(ctx, change, alert);
    if (alert) showConnected(ctx, ctx.require(activeSourcePlugin).label().name);
    notifyMission(ctx.state.mission);
  };
}

/**
 * activeSource:connect-requested (the top bar's "Connect device…"): shows Render with its Connect
 * panel open on the asked tab.
 *
 * @param ctx - Domain context of renderView.
 * @returns The hook.
 */
export function onConnectRequested(ctx: RenderViewCtx): (request: ConnectRequest) => void {
  return ({ tab }) => {
    ctx.require(workspacePlugin).show("render");
    openConnect(ctx, tab);
  };
}

/**
 * renderView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of renderView.
 * @returns The six hooks.
 */
export function createHandlers(ctx: RenderViewCtx): RenderViewHooks {
  return {
    "workspace:changed": onWorkspaceChanged(ctx),
    "link:status": onLinkStatus(ctx),
    "link:project": onProject(ctx),
    "workspace:reveal": onReveal(ctx),
    "activeSource:changed": onSourceChanged(ctx),
    "activeSource:connect-requested": onConnectRequested(ctx)
  };
}
