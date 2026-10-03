/**
 * @file gameView plugin — the picker label (pure): its text, its estimated size in device px at
 * the frame scale, the counter-scale that keeps its text 11 px, and where it sits (under the box,
 * flipped above at the device bottom, right-aligned at the right edge).
 */
import type { PageRect, SceneNode } from "../../panels/shared/scene";

/**
 * Gap between the box and its label, in device px.
 */
const LABEL_GAP = 4;

/**
 * Average width of one 11 px label character, in CSS px.
 */
const LABEL_CHAR_PX = 6.6;

/**
 * Horizontal padding of the label, in CSS px.
 */
const LABEL_PAD_PX = 12;

/**
 * Height of the label, in CSS px.
 */
const LABEL_HEIGHT_PX = 18;

/**
 * Where the label sits, in device px; `flipped` when it moved above the box.
 *
 * @param box - The element box in device (page) px.
 * @param label - Label size in device px.
 * @param label.w - Label width.
 * @param label.h - Label height.
 * @param device - Device size.
 * @param device.w - Device width.
 * @param device.h - Device height.
 * @returns The label origin and whether it flipped.
 * @example
 * ```ts
 * labelPlacement({ x: 40, y: 800, w: 80, h: 40 }, { w: 120, h: 18 }, { w: 393, h: 852 }); // { x: 40, y: 778, flipped: true }
 * ```
 */
export function labelPlacement(
  box: PageRect,
  label: { readonly w: number; readonly h: number },
  device: { readonly w: number; readonly h: number }
): { x: number; y: number; flipped: boolean } {
  const below = box.y + box.h + LABEL_GAP;
  const flipped = below + label.h > device.h;
  const y = flipped ? box.y - LABEL_GAP - label.h : below;
  const x = box.x + label.w > device.w ? box.x + box.w - label.w : box.x;
  return { x: Math.max(0, x), y, flipped };
}

/**
 * The counter-scale of a label inside the scaled overlay: 1 / frame scale (1 when hidden).
 *
 * @param scale - `gameFrame().box().scale`.
 * @returns The CSS scale for the label.
 * @example
 * ```ts
 * counterScale(0.5); // 2
 * ```
 */
export function counterScale(scale: number): number {
  return scale > 0 ? 1 / scale : 1;
}

/**
 * Estimated label size in device px at a frame scale.
 *
 * @param text - The label text.
 * @param scale - The frame scale.
 * @returns Width and height in device px.
 * @example
 * ```ts
 * labelSize("coinPill · row · 290×76", 1).h; // 18
 * ```
 */
export function labelSize(text: string, scale: number): { w: number; h: number } {
  const factor = counterScale(scale);
  return {
    w: (text.length * LABEL_CHAR_PX + LABEL_PAD_PX) * factor,
    h: LABEL_HEIGHT_PX * factor
  };
}

/**
 * The hover label `name · Type · w×h` in rounded CSS px (no size for an unplaced node).
 *
 * @param node - The scene node.
 * @returns The text.
 * @example
 * ```ts
 * labelText(scene.nodes.get("ui:boardScreen/hudRow/coinPill")!); // "coinPill · row · 290×76"
 * ```
 */
export function labelText(node: SceneNode): string {
  const head = `${node.name} · ${node.type}`;
  if (node.rect === undefined) return head;
  return `${head} · ${Math.round(node.rect.w)}×${Math.round(node.rect.h)}`;
}
