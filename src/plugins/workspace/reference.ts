/**
 * @file workspace plugin — Reference mode (D-27): a flag, always off at load and never persisted.
 * While on, the frame box carries `data-reference`: its overlay takes the pointer (the game gets
 * no input) and an accent outline marks the frame; gameView draws its element proxies into the
 * overlay. A change emits `workspace:reference`. The top-bar button, key R, the palette and Esc
 * (layer `reference`) drive it.
 */
import { syncFrame } from "./frame/frame";
import type { WorkspaceCtx } from "./types";

/**
 * The part of the workspace ctx Reference mode needs.
 */
type ReferenceCtx = Pick<WorkspaceCtx, "state" | "emit">;

/**
 * Turns Reference mode on or off; a change re-marks the frame box, emits `workspace:reference`
 * and re-renders the shell.
 *
 * @param ctx - State and emit.
 * @param on - The new flag.
 */
export function setReference(ctx: ReferenceCtx, on: boolean): void {
  const { state } = ctx;
  if (state.reference === on) return;

  state.reference = on;
  syncFrame(ctx);
  ctx.emit("workspace:reference", { on });
  state.ui.bump();
}

/**
 * Flips Reference mode (the top-bar button, key R, the palette).
 *
 * @param ctx - State and emit.
 */
export function toggleReference(ctx: ReferenceCtx): void {
  setReference(ctx, !ctx.state.reference);
}

/**
 * The Esc closer of the `reference` layer: turns Reference mode off.
 *
 * @param ctx - State and emit.
 * @returns True when it was on (the press is consumed).
 */
export function closeReference(ctx: ReferenceCtx): boolean {
  if (!ctx.state.reference) return false;
  setReference(ctx, false);
  return true;
}
