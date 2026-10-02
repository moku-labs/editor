/**
 * @file Shared view module — scene: ui nodes, projection entities, host slots, paint order.
 */
import type { ElementRef, SceneError, SceneInput, SceneSnapshot } from "./types";

/**
 * The node id of a ref: "ui:<path>" or "entity:<id>".
 *
 * @param _ref - An element ref.
 * @example
 * ```ts
 * refId({ kind: "entity", id: 1_048_580 }); // "entity:1048580"
 * ```
 */
export function refId(_ref: ElementRef): string {
  throw new Error("not implemented");
}

/**
 * Builds the scene from the wire values of game.ui, game.entities and game.projections.
 *
 * @param _input - The three values, the frame and the calibration.
 * @example
 * ```ts
 * const scene = buildScene({ ui, entities, projections, frame: 1841, calibration });
 * ```
 */
export function buildScene(_input: SceneInput): SceneSnapshot | SceneError {
  throw new Error("not implemented");
}
