/**
 * @file gameView plugin — hooks of the global tools events: link:status, workspace:changed,
 * workspace:open-sheet, workspace:inspect (R9).
 */
import type { ToolsEvents } from "../../config";
import { workspacePlugin } from "../workspace";
import { openSheet } from "./capture/sheet";
import { inspectElement } from "./element/select";
import { startSceneWatches, stopSceneWatches } from "./scene/watch";
import { notify } from "./state";
import type { GameViewCtx, GameViewHooks } from "./types";

/**
 * gameView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of gameView.
 * @returns The four hooks.
 * @example
 * ```ts
 * createToolsPlugin("gameView", { hooks: createHandlers });
 * ```
 */
export function createHandlers(ctx: GameViewCtx): GameViewHooks {
  return {
    "link:status": onLinkStatus(ctx),
    "workspace:changed": onWorkspaceChanged(ctx),
    "workspace:open-sheet": onOpenSheet(ctx),
    "workspace:inspect": onInspect(ctx)
  };
}

/**
 * Applies one link status: a new session (live/paused after lost, or another session id) drops
 * the scene, the calibration and the manifest; empty turns the picker off, closes the popover
 * and ends a running series early; silent and lost keep everything (the UI marks it stale).
 *
 * @param ctx - Domain context of gameView.
 * @param payload - The link:status payload.
 * @example
 * ```ts
 * applyLinkStatus(ctx, { status: { kind: "live", frame: 2 }, session: "s-2" });
 * ```
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
    state.manifest = undefined;
  }
  if (status.kind === "empty") {
    state.picker = { on: false, hover: undefined };
    state.series.popover = false;
    if (state.series.recording !== undefined) state.series.recording.stopRequested = true;
  }
  state.link = { status: status.kind, session: session ?? previous.session };
  notify(state);
}

/**
 * The link:status hook.
 *
 * @param ctx - Domain context of gameView.
 * @returns The handler.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "empty" } });
 * ```
 */
export function onLinkStatus(ctx: GameViewCtx): (payload: ToolsEvents["link:status"]) => void {
  return payload => applyLinkStatus(ctx, payload);
}

/**
 * The workspace:changed hook: entering Game starts the scene watches; leaving stops them and
 * turns the picker off (a highlight box stays until cleared).
 *
 * @param ctx - Domain context of gameView.
 * @returns The handler.
 * @example
 * ```ts
 * onWorkspaceChanged(ctx)({ ws: "game" });
 * ```
 */
export function onWorkspaceChanged(
  ctx: GameViewCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  return ({ ws }) => {
    if (ws === "game") {
      startSceneWatches(ctx);
    } else {
      stopSceneWatches(ctx);
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
 * @example
 * ```ts
 * onOpenSheet(ctx)({ index: ".moku/captures/series-2026-09-24-1015/index.json" });
 * ```
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
 * @example
 * ```ts
 * onInspect(ctx)({ ref: { kind: "entity", id: 1_048_580 } });
 * ```
 */
export function onInspect(ctx: GameViewCtx): (payload: ToolsEvents["workspace:inspect"]) => void {
  return ({ ref }) => {
    ctx.require(workspacePlugin).show("game");
    inspectElement(ctx, ref);
  };
}
