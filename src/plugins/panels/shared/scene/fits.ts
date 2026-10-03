/**
 * @file Shared view module — scene: the drawn rect of a ui node through its fit chain.
 */
import type { PageRect } from "./types";

/**
 * One link of a fit chain: the natural rect of a ui node and the scale it is drawn at.
 */
export type FitLink = { readonly rect: PageRect; readonly fitScale: number };

/**
 * Scales a natural rect about the centre of every link with fitScale ≠ 1, nearest first: the
 * game's documented `fit: "contain"` rule, re-implemented here (the game is not imported).
 *
 * @param natural - The natural rect in root units.
 * @param fits - The fit chain, nearest first, the node itself included.
 * @returns The drawn rect in root units.
 * @example
 * ```ts
 * drawnRect({ x: 0, y: 0, w: 100, h: 100 }, [{ rect: { x: 0, y: 0, w: 100, h: 100 }, fitScale: 0.5 }]); // { x: 25, y: 25, w: 50, h: 50 }
 * ```
 */
export function drawnRect(natural: PageRect, fits: readonly FitLink[]): PageRect {
  let drawn: PageRect = { ...natural };

  for (const link of fits) {
    if (link.fitScale === 1) continue;

    const centreX = link.rect.x + link.rect.w / 2;
    const centreY = link.rect.y + link.rect.h / 2;

    drawn = {
      x: centreX + link.fitScale * (drawn.x - centreX),
      y: centreY + link.fitScale * (drawn.y - centreY),
      w: drawn.w * link.fitScale,
      h: drawn.h * link.fitScale
    };
  }

  return drawn;
}

/**
 * The scale a fit chain draws at: the product of its fit scales (drawn width / natural width).
 *
 * @param fits - The fit chain.
 * @returns The product, 1 for an empty chain.
 * @example
 * ```ts
 * fitScaleOf([{ rect: { x: 0, y: 0, w: 10, h: 10 }, fitScale: 0.5 }]); // 0.5
 * ```
 */
export function fitScaleOf(fits: readonly FitLink[]): number {
  let scale = 1;

  for (const link of fits) scale *= link.fitScale;

  return scale;
}
