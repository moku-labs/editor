/**
 * @file gameView plugin — api factory: composes the scene, capture, series, notes and element
 * sub-modules.
 */
import type { GameViewApi, GameViewCtx } from "./types";

/**
 * Creates the gameView api.
 *
 * @param _ctx - Domain context of gameView.
 * @example
 * ```ts
 * createGameViewApi(ctx).pick(true);
 * ```
 */
export function createGameViewApi(_ctx: GameViewCtx): GameViewApi {
  throw new Error("not implemented");
}
