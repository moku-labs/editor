/**
 * @file renderView timeline — the geometry of a canvas of Mission control: its CSS size, its
 * device pixel ratio and the plot inside its margins. Typed stub of build wave 0 (spec 09 §
 * M17, RV0): the signatures are the contract the other Mission control units build against;
 * build wave 3 (RV2) writes the bodies.
 */
import { notBuilt } from "../stub";

/**
 * A canvas's geometry, CSS px: the backing store is `width × dpr` by `height × dpr`.
 *
 * @example
 * ```ts
 * const layout: TimelineLayout = { width: 960, height: 220, dpr: 2, plot: { x: 40, y: 8, w: 912, h: 196 } };
 * ```
 */
export type TimelineLayout = {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly plot: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

/**
 * The geometry of a canvas of a size.
 *
 * @param _width - CSS px.
 * @param _height - CSS px.
 * @param _dpr - devicePixelRatio.
 * @returns The layout.
 * @throws {Error} Until build wave 3: "renderView timeline/layoutOf is not built yet".
 */
export function layoutOf(_width: number, _height: number, _dpr: number): TimelineLayout {
  return notBuilt("timeline/layoutOf", 3);
}
