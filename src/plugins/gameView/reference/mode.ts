/**
 * @file gameView plugin — Reference mode (finding 17, D-27): `workspace:reference` turns it on
 * or off. While on, the scene watch stays alive in every workspace, `game.position` is watched
 * for the flow node of the proxies and gameView's overlay root renders the proxy layer (the
 * frame overlay takes the pointer, workspace's part). Off drops the layer and, outside Game, the
 * watch. Also the proxy hover and "Copy reference".
 */
import { linkPlugin } from "../../link";
import type { SceneNode } from "../../panels/shared/scene";
import { workspacePlugin } from "../../workspace";
import { positionOf } from "../capture/naming";
import { reportFailure } from "../report";
import { startSceneWatches, stopSceneWatches } from "../scene/watch";
import { notify } from "../state";
import type { GameViewCtx, ReferenceState } from "../types";
import { ensureOverlayRoot } from "../ui/OverlayRoot";
import { referenceLine } from "./proxies";

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
 * "Copy reference": the reference line of a node on the clipboard, then a toast; a clipboard
 * that refuses or does not exist is toasted.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The node.
 * @param flowNode - "<flow>/<node>" of the game position.
 * @returns Resolves when copied or toasted.
 */
export async function copyReference(
  ctx: GameViewCtx,
  node: SceneNode,
  flowNode: string | undefined
): Promise<void> {
  const source = node.key === undefined ? undefined : ctx.state.found.get(node.key);
  const line = referenceLine(node, flowNode, source);
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard === undefined) throw new Error("The clipboard is not available.");
    await clipboard.writeText(line);
    ctx.require(workspacePlugin).toast("✓ Reference copied");
  } catch (error) {
    reportFailure(ctx, "Copy failed", "gameView: copy reference failed", error);
  }
}

/**
 * Drops the game.position watch on stop (teardown context).
 *
 * @param state - Own state.
 * @param state.reference - Reference mode.
 * @example
 * ```ts
 * dropReference(ctx.state); // game.position unwatched, Reference mode off in gameView's state
 * ```
 */
export function dropReference(state: { reference: ReferenceState }): void {
  state.reference.unwatch?.();
  state.reference = referenceOff();
}
