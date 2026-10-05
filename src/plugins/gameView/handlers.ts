/**
 * @file gameView plugin — hooks of the global tools events: link:status, workspace:changed,
 * workspace:open-sheet, workspace:inspect (R9), workspace:reference (D-27).
 */
import type { ToolsEvents } from "../../config";
import { isReloading } from "../registry/protocol";
import { workspacePlugin } from "../workspace";
import { openSheet } from "./capture/sheet";
import { inspectElement } from "./element/select";
import { setReferenceMode } from "./reference/mode";
import { startSceneWatches, stopSceneWatches } from "./scene/watch";
import { notify } from "./state";
import type { GameViewCtx, GameViewHooks } from "./types";

/**
 * gameView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of gameView.
 * @returns The five hooks.
 */
export function createHandlers(ctx: GameViewCtx): GameViewHooks {
  return {
    "link:status": onLinkStatus(ctx),
    "workspace:changed": onWorkspaceChanged(ctx),
    "workspace:open-sheet": onOpenSheet(ctx),
    "workspace:inspect": onInspect(ctx),
    "workspace:reference": onReference(ctx)
  };
}

/**
 * Applies one link status: a new session (live/paused after lost, or another session id) drops
 * the scene, the calibration and the manifest; empty turns the picker off, closes the popover
 * and ends a running series early; silent and lost keep everything (the UI marks it stale). An
 * expected reload (`isReloading`) keeps the toolbar Reload busy (U11).
 *
 * @param ctx - Domain context of gameView.
 * @param payload - The link:status payload.
 */
function applyLinkStatus(ctx: GameViewCtx, payload: ToolsEvents["link:status"]): void {
  const { state } = ctx;
  const { status, session } = payload;
  const previous = state.link;
  const attached = status.kind === "live" || status.kind === "paused";
  const changed =
    session !== undefined && previous.session !== undefined && session !== previous.session;

  if (attached && (previous.status === "lost" || changed)) {
    state.scene = undefined;
    state.calibration = undefined;
    state.calibrationRead = false;
    state.calibrationRun.used = undefined;
    state.calibrationRun.waiting = false;
    state.manifest = undefined;
  }
  if (status.kind === "empty") {
    state.picker = { on: false, hover: undefined };
    state.series.popover = false;
    if (state.series.recording !== undefined) state.series.recording.stopRequested = true;
  }
  state.link = {
    status: status.kind,
    session: session ?? previous.session,
    reloading: isReloading(status)
  };
  notify(state);
}

/**
 * The link:status hook.
 *
 * @param ctx - Domain context of gameView.
 * @returns The handler.
 */
export function onLinkStatus(ctx: GameViewCtx): (payload: ToolsEvents["link:status"]) => void {
  return payload => applyLinkStatus(ctx, payload);
}

/**
 * The workspace:changed hook: entering Game starts the scene watches; leaving stops them (not
 * while Reference mode keeps them) and turns the picker off (a highlight box stays until
 * cleared).
 *
 * @param ctx - Domain context of gameView.
 * @returns The handler.
 */
export function onWorkspaceChanged(
  ctx: GameViewCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  return ({ ws }) => {
    if (ws === "game") {
      startSceneWatches(ctx);
    } else {
      if (!ctx.state.reference.on) stopSceneWatches(ctx);
      ctx.state.picker = { on: false, hover: undefined };
    }
    notify(ctx.state);
  };
}

/**
 * The workspace:open-sheet hook (filesView "Open contact sheet"): openSheet(index).
 *
 * @param ctx - Domain context of gameView.
 * @returns The handler.
 */
export function onOpenSheet(
  ctx: GameViewCtx
): (payload: ToolsEvents["workspace:open-sheet"]) => void {
  return ({ index }) => {
    void openSheet(ctx, index);
  };
}

/**
 * The workspace:inspect hook (renderView "Inspect in Game", R9): shows Game, then inspect(ref).
 *
 * @param ctx - Domain context of gameView.
 * @returns The handler.
 */
export function onInspect(ctx: GameViewCtx): (payload: ToolsEvents["workspace:inspect"]) => void {
  return ({ ref }) => {
    ctx.require(workspacePlugin).show("game");
    inspectElement(ctx, ref);
  };
}

/**
 * The workspace:reference hook (D-27): Reference mode on or off.
 *
 * @param ctx - Domain context of gameView.
 * @returns The handler.
 */
export function onReference(
  ctx: GameViewCtx
): (payload: ToolsEvents["workspace:reference"]) => void {
  return ({ on }) => setReferenceMode(ctx, on);
}
