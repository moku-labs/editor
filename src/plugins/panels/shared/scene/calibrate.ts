/**
 * @file Shared view module — scene: calibration from one keyed ui element and its game.rect.
 */
import type { Json } from "../../../registry/protocol";
import { drawnRect } from "./fits";
import type { Calibration, PageRect } from "./types";
import { isShapePath, readUi, uiVisits } from "./wire";

/**
 * The first keyed ui node with a width, in tree order, and its drawn rect; undefined when none
 * (or when game.ui has the wrong shape). The view reads `game.rect { key }` for that key.
 *
 * @param ui - The game.ui value.
 * @returns The key and the drawn rect in reference units, or undefined.
 * @example
 * ```ts
 * const target = calibrationTarget(ui); // { key: "boardScreen", drawn: { x: 0, y: 0, w: 1080, h: 1440 } }
 * ```
 */
export function calibrationTarget(
  ui: Json
): { readonly key: string; readonly drawn: PageRect } | undefined {
  const top = readUi(ui);

  if (isShapePath(top)) return undefined;

  for (const { node, fits } of uiVisits(top)) {
    if (node.key === undefined) continue;

    const drawn = drawnRect(node.rect, fits);

    if (drawn.w > 0) return { key: node.key, drawn };
  }

  return undefined;
}

/**
 * The game's `toScreen` is a uniform scale plus an offset: scale = P.w / D.w,
 * x = P.x − D.x·scale, y = P.y − D.y·scale. A drawn rect without a width keeps scale 1.
 *
 * @param page - The page rect P from game.rect.
 * @param drawn - The drawn rect D of the same element, in reference units.
 * @returns The calibration from reference units to page px.
 * @example
 * ```ts
 * calibrationFrom({ x: 20, y: 40, w: 540, h: 720 }, { x: 0, y: 0, w: 1080, h: 1440 }); // { scale: 0.5, x: 20, y: 40 }
 * ```
 */
export function calibrationFrom(page: PageRect, drawn: PageRect): Calibration {
  const scale = drawn.w > 0 ? page.w / drawn.w : 1;

  return { scale, x: page.x - drawn.x * scale, y: page.y - drawn.y * scale };
}

/**
 * Applies a calibration to a rect.
 *
 * @param rect - A rect in reference units.
 * @param calibration - The calibration.
 * @returns The rect in page px.
 * @example
 * ```ts
 * toPage({ x: 100, y: 200, w: 40, h: 20 }, { scale: 0.5, x: 10, y: 30 }); // { x: 60, y: 130, w: 20, h: 10 }
 * ```
 */
export function toPage(rect: PageRect, calibration: Calibration): PageRect {
  const { scale } = calibration;

  return {
    x: rect.x * scale + calibration.x,
    y: rect.y * scale + calibration.y,
    w: rect.w * scale,
    h: rect.h * scale
  };
}
