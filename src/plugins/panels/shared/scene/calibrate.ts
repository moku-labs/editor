/**
 * @file Shared view module — scene: calibration from one keyed ui element and its page rect, and
 * the source that page rect comes from (`game.locate` on game 0.4, `game.rect` on game 0.1).
 */
import type { Json, Manifest } from "../../../registry/protocol";
import { drawnRect } from "./fits";
import type { Calibration, PageRect } from "./types";
import { isShapePath, readUi, uiVisits } from "./wire";

/**
 * The sources an element's page rect is read from, newest first: game 0.4 replaced `game.rect`
 * with `game.locate`. Both take `{ key }` and answer `{ x, y, w, h }` in page px, or nothing.
 */
export const RECT_SOURCE_IDS = ["game.locate", "game.rect"] as const;

/**
 * A source an element's page rect is read from.
 */
export type RectSourceId = (typeof RECT_SOURCE_IDS)[number];

/**
 * The source a view reads element rects from: `game.locate` when the manifest lists it, else
 * `game.rect`; undefined when it lists neither (or no game is attached), so the game reports no
 * element rects and nothing is read.
 *
 * @param manifest - The game's manifest, undefined before a session.
 * @returns The source id, or undefined.
 * @example
 * ```ts
 * const source = rectSourceOf(link.manifest()); // "game.locate" on game 0.4, "game.rect" on 0.1
 * if (source !== undefined) page = rectOf(await link.read(source, { key: target.key }));
 * ```
 */
export function rectSourceOf(
  manifest: Pick<Manifest, "sources"> | undefined
): RectSourceId | undefined {
  if (manifest === undefined) return undefined;

  return RECT_SOURCE_IDS.find(id => manifest.sources.some(source => source.id === id));
}

/**
 * The first keyed ui node with a width, in tree order, and its drawn rect; undefined when none
 * (or when game.ui has the wrong shape). The view reads the page rect of that key from the
 * source `rectSourceOf` picks.
 *
 * @param ui - The game.ui value.
 * @returns The key and the drawn rect in reference units, or undefined.
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
 * @param page - The page rect P from `game.locate` or `game.rect`.
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
