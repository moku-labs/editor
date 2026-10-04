/**
 * @file gameView plugin — `scene()` and `locate()`: the watched scene while Game is shown, else
 * one read of the three sources (and the calibration when not read yet or its target changed),
 * built with the shared buildScene (R8).
 */
import { linkPlugin } from "../../link";
import type { ElementRef, PageRect, SceneError, SceneSnapshot } from "../../panels/shared/scene";
import { buildScene, refId } from "../../panels/shared/scene";
import { notify } from "../state";
import type { GameViewCtx } from "../types";
import { calibrate, targetChanged } from "./calibrate";
import { frameOf } from "./rebuild";

/**
 * The startup-style error of a scene value of the wrong shape.
 *
 * @param error - The shape error of buildScene.
 * @returns The error to throw.
 * @example
 * ```ts
 * shapeError({ error: "shape", source: "game.ui", path: "$.children" }).message; // "[moku-editor] game.ui has the wrong shape at $.children.\n  …"
 * ```
 */
function shapeError(error: SceneError): Error {
  return new Error(
    `[moku-editor] ${error.source} has the wrong shape at ${error.path}.\n  Use an editor and a game of the same protocol version.`
  );
}

/**
 * Waits until no calibration runs: one in flight rebuilds the watched scene when it lands, and
 * may start the next one when the target changed meanwhile.
 *
 * @param ctx - Domain context of gameView.
 * @returns Resolves when the calibration is settled.
 */
async function calibrationSettled(ctx: GameViewCtx): Promise<void> {
  const run = ctx.state.calibrationRun;
  while (run.pending !== undefined) await run.pending;
}

/**
 * The scene: the watched one while Game is shown (after the calibration in flight), else built
 * from one read of the three sources.
 *
 * @param ctx - Domain context of gameView.
 * @returns The scene snapshot.
 * @throws {Error} The link's WireError, or a shape error.
 */
export async function readScene(ctx: GameViewCtx): Promise<SceneSnapshot> {
  const { state } = ctx;
  if (state.watching.length > 0 && state.scene !== undefined) {
    await calibrationSettled(ctx);
    if (state.scene !== undefined) return state.scene;
  }

  const link = ctx.require(linkPlugin);
  const [ui, entities, projections] = await Promise.all([
    link.read("game.ui"),
    link.read("game.entities"),
    link.read("game.projections")
  ]);
  state.sources = { ui, entities, projections };
  if (!state.calibrationRead || targetChanged(state)) await calibrate(ctx);

  const built = buildScene({
    ui,
    entities,
    projections,
    frame: frameOf(link.status(), 0),
    calibration: state.calibration
  });
  if ("error" in built) throw shapeError(built);
  state.scene = built;
  notify(state);
  return built;
}

/**
 * The page rect of one element, from readScene.
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element.
 * @returns The rect, undefined when unknown or unplaced.
 */
export async function locateElement(
  ctx: GameViewCtx,
  ref: ElementRef
): Promise<PageRect | undefined> {
  const scene = await readScene(ctx);
  return scene.nodes.get(refId(ref))?.rect;
}
