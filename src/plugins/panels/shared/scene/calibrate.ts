/**
 * @file Shared view module — scene: calibration from one keyed ui element and its game.rect.
 */
import type { Json } from "../../../registry/protocol";
import type { Calibration, PageRect } from "./types";

/**
 * The first keyed ui node with a width, and its drawn rect; undefined when none.
 *
 * @param _ui - The game.ui value.
 * @example
 * ```ts
 * const target = calibrationTarget(ui); // { key: "coins", drawn: { … } }
 * ```
 */
export function calibrationTarget(
  _ui: Json
): { readonly key: string; readonly drawn: PageRect } | undefined {
  throw new Error("not implemented");
}

/**
 * scale = P.w / D.w, x = P.x − D.x·scale, y = P.y − D.y·scale.
 *
 * @param _page - The page rect from game.rect.
 * @param _drawn - The drawn rect of the same element.
 * @example
 * ```ts
 * const calibration = calibrationFrom(pageRect, target.drawn);
 * ```
 */
export function calibrationFrom(_page: PageRect, _drawn: PageRect): Calibration {
  throw new Error("not implemented");
}

/**
 * Applies a calibration to a rect.
 *
 * @param _rect - A rect in reference units.
 * @param _calibration - The calibration.
 * @example
 * ```ts
 * toPage(node.rect, calibration);
 * ```
 */
export function toPage(_rect: PageRect, _calibration: Calibration): PageRect {
  throw new Error("not implemented");
}
