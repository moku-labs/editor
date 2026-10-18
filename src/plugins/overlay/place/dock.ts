/**
 * @file overlay plugin — where the window sits (pure): its size in a mode, the free vertical range
 * inside the safe area, the top of a place, and the snap of a drop to the nearer edge.
 */
import type { Insets, OverlayMode, Place, Viewport, WindowSize } from "../types";
import {
  CARD_H,
  CARD_H_MIN,
  CARD_W,
  CARD_W_COMPACT,
  COMPACT_BELOW,
  EDGE_GAP,
  PILL_H,
  PILL_W
} from "../types";

/** The strip of the screen the card always leaves to the game, CSS px. */
const GAME_STRIP = 40;

/** The share of the viewport height the card takes before its bounds. */
const CARD_SHARE = 0.45;

/**
 * The window's box in a mode: the pill 138 × 36; the card 344 wide (300 below a 384 px
 * viewport, never wider than the viewport less 40) and `min(372, max(240, 45 % of the height))`
 * high; nothing when hidden.
 *
 * @param mode - The mode.
 * @param viewport - The viewport.
 * @returns The size.
 * @example
 * ```ts
 * windowSize("card", { w: 384, h: 833 }); // { w: 344, h: 372, compact: false }
 * ```
 */
export function windowSize(mode: OverlayMode, viewport: Viewport): WindowSize {
  if (mode === "hidden") return { w: 0, h: 0, compact: false };
  if (mode === "pill") return { w: PILL_W, h: PILL_H, compact: false };

  const compact = viewport.w < COMPACT_BELOW;
  const w = Math.min(compact ? CARD_W_COMPACT : CARD_W, viewport.w - GAME_STRIP);
  const h = Math.min(CARD_H, Math.max(CARD_H_MIN, Math.round(CARD_SHARE * viewport.h)));
  return { w, h, compact };
}

/**
 * The tops the window may take: 8 px under the top inset to 8 px over the bottom inset.
 *
 * @param size - The window's size.
 * @param viewport - The viewport.
 * @param insets - The safe area.
 * @returns The range; `maxTop` never below `minTop`.
 * @example
 * ```ts
 * range({ w: 344, h: 372, compact: false }, { w: 384, h: 833 }, { top: 32, right: 0, bottom: 24, left: 0 }); // { minTop: 40, maxTop: 429 }
 * ```
 */
export function range(
  size: WindowSize,
  viewport: Viewport,
  insets: Insets
): { readonly minTop: number; readonly maxTop: number } {
  const minTop = insets.top + EDGE_GAP;
  const maxTop = viewport.h - insets.bottom - EDGE_GAP - size.h;
  return { minTop, maxTop: Math.max(minTop, maxTop) };
}

/**
 * The top of a place: its share of the free range, rounded.
 *
 * @param place - The place.
 * @param size - The window's size.
 * @param viewport - The viewport.
 * @param insets - The safe area.
 * @returns CSS px from the top of the viewport.
 * @example
 * ```ts
 * topOf({ dock: "right", y: 1 }, { w: 344, h: 372, compact: false }, { w: 384, h: 833 }, { top: 32, right: 0, bottom: 24, left: 0 }); // 429
 * ```
 */
export function topOf(place: Place, size: WindowSize, viewport: Viewport, insets: Insets): number {
  const { minTop, maxTop } = range(size, viewport, insets);
  return Math.round(minTop + place.y * (maxTop - minTop));
}

/**
 * The place of a drop: the edge nearer to the window's centre, the top clamped into the range
 * and turned into a share of it (0 when the range is empty).
 *
 * @param drop - The window's centre x and top where it was let go.
 * @param drop.centerX - CSS px of the window's centre.
 * @param drop.top - CSS px of the window's top.
 * @param size - The window's size.
 * @param viewport - The viewport.
 * @param insets - The safe area.
 * @returns The place.
 * @example
 * ```ts
 * snap({ centerX: 100, top: 200 }, { w: 344, h: 372, compact: false }, { w: 384, h: 833 }, { top: 32, right: 0, bottom: 24, left: 0 }).dock; // "left"
 * ```
 */
export function snap(
  drop: { readonly centerX: number; readonly top: number },
  size: WindowSize,
  viewport: Viewport,
  insets: Insets
): Place {
  const { minTop, maxTop } = range(size, viewport, insets);
  const top = Math.min(maxTop, Math.max(minTop, drop.top));
  const span = maxTop - minTop;
  return {
    dock: drop.centerX < viewport.w / 2 ? "left" : "right",
    y: span === 0 ? 0 : (top - minTop) / span
  };
}
