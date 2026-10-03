/**
 * @file renderView plugin — the pink box over the game frame: renderView's own Preact root inside
 * `workspace.gameFrame().overlay()` (device space, R4), so it shows wherever the frame is docked.
 */
import { h, render } from "preact";
import type { PageRect } from "../panels/shared/scene";
import { refId } from "../panels/shared/scene";
import { workspacePlugin } from "../workspace";
import { BoxRoot } from "./components/BoxRoot";
import type { RenderViewCtx, RenderViewState } from "./types";

/**
 * The page rect of the ringed element: its node in a calibrated scene, if placed.
 *
 * @param state - renderView state (`box`, `scene`).
 * @returns The rect, or undefined when nothing can be drawn.
 */
function boxRect(state: RenderViewState): PageRect | undefined {
  const { box, scene } = state;
  if (box === undefined || scene === undefined || !scene.calibrated) return undefined;
  return scene.nodes.get(refId(box))?.rect;
}

/**
 * Draws the box of `state.box` into renderView's overlay root (created on the first rect), or
 * clears it.
 *
 * @param ctx - Domain context of renderView.
 */
export function drawBox(ctx: RenderViewCtx): void {
  const { state } = ctx;
  const rect = boxRect(state);
  if (rect === undefined && state.overlayRoot === undefined) return;

  if (state.overlayRoot === undefined) {
    const root = document.createElement("div");
    root.dataset.render = "box";
    ctx.require(workspacePlugin).gameFrame().overlay().append(root);
    state.overlayRoot = root;
  }
  render(h(BoxRoot, { rect }), state.overlayRoot);
}

/**
 * Unmounts and removes renderView's overlay root (onStop).
 *
 * @param state - renderView state.
 */
export function removeOverlay(state: RenderViewState): void {
  const root = state.overlayRoot;
  if (root === undefined) return;

  state.overlayRoot = undefined;
  // eslint-disable-next-line unicorn/no-null -- Preact unmounts a root by rendering null
  render(null, root);
  root.remove();
}
