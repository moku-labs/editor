/**
 * @file Shared view module — scene: the drawn rect of a ui node through its fit chain.
 */
import type { PageRect } from "./types";

/**
 * Scales a natural rect about the centre of every link with fitScale ≠ 1, nearest first.
 *
 * @param _natural - The natural rect in root units.
 * @param _fits - The fit chain, nearest first.
 * @example
 * ```ts
 * drawnRect({ x: 0, y: 0, w: 100, h: 100 }, [{ rect: { x: 0, y: 0, w: 100, h: 100 }, fitScale: 0.5 }]); // { x: 25, y: 25, w: 50, h: 50 }
 * ```
 */
export function drawnRect(
  _natural: PageRect,
  _fits: readonly { readonly rect: PageRect; readonly fitScale: number }[]
): PageRect {
  throw new Error("not implemented");
}
