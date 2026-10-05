/**
 * @file gameView plugin — Reference mode (finding 17, D-27): `workspace:reference` turns it on
 * or off. While on, the scene watch stays alive in every workspace, `game.position` is watched
 * for the flow node of the proxies and gameView's overlay root renders the proxy layer (the
 * frame overlay takes the pointer, workspace's part). Off drops the layer and, outside Game, the
 * watch. Also the proxy hover.
 */
import { linkPlugin } from "../../link";
import { workspacePlugin } from "../../workspace";
import { positionOf } from "../capture/naming";
import { startSceneWatches, stopSceneWatches } from "../scene/watch";
import { notify } from "../state";
import type { GameViewCtx, ReferenceState } from "../types";
import { ensureOverlayRoot } from "../ui/OverlayRoot";

/**
 * Reference mode while off.
 *
 * @returns A fresh off state.
 */
function referenceOff(): ReferenceState {
  return { on: false, hover: undefined, node: undefined, unwatch: undefined };
}

/**
 * Turns Reference mode on: the scene watch, the game.position watch and the overlay root.
 *
 * @param ctx - Domain context of gameView.
 */
function startReference(ctx: GameViewCtx): void {
  const { state } = ctx;
  const reference = state.reference;
  reference.on = true;
  startSceneWatches(ctx);

  // The proxies name the flow node: follow game.position, re-render only when the path changes.
  reference.unwatch = ctx.require(linkPlugin).watch("game.position", undefined, value => {
    const node = positionOf(value).path;
    if (reference.node === node) return;
    reference.node = node;
    notify(state);
  });

  ensureOverlayRoot(ctx);
}

/**
 * Turns Reference mode off: the game.position watch, the hover and, outside Game, the scene
 * watch.
 *
 * @param ctx - Domain context of gameView.
 */
function stopReference(ctx: GameViewCtx): void {
  const { state } = ctx;
  state.reference.unwatch?.();
  state.reference = referenceOff();
  if (ctx.require(workspacePlugin).active() !== "game") stopSceneWatches(ctx);
}

/**
 * Turns Reference mode on or off (the `workspace:reference` hook); the same value again does
 * nothing.
 *
 * @param ctx - Domain context of gameView.
 * @param on - The flag of workspace.
 */
export function setReferenceMode(ctx: GameViewCtx, on: boolean): void {
  if (ctx.state.reference.on === on) return;
  if (on) startReference(ctx);
  else stopReference(ctx);
  notify(ctx.state);
}

/**
 * The proxy under the pointer: the overlay draws the picker hover box for it; undefined clears.
 *
 * @param ctx - Domain context of gameView.
 * @param id - The node id of the proxy; omitted when the pointer left the layer.
 */
export function hoverProxy(ctx: GameViewCtx, id?: string): void {
  if (ctx.state.reference.hover === id) return;
  ctx.state.reference.hover = id;
  notify(ctx.state);
}

/**
 * Drops the game.position watch on stop (teardown context).
 *
 * @param state - Own state.
 * @param state.reference - Reference mode.
 */
export function dropReference(state: { reference: ReferenceState }): void {
  state.reference.unwatch?.();
  state.reference = referenceOff();
}
