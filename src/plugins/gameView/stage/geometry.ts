/**
 * @file gameView plugin — stage geometry (pure): the fit scale of the device in the stage, the
 * slot size, the strip of the stage a floating drawer covers, the safe-area bands of a resolved
 * device, the dynamic island and home bar rules, and the inline position of a rect in device px. Sizes and insets come from workspace's
 * resolveDevice (R8); gameView has no rule of its own.
 */
import type { PageRect } from "../../panels/shared/scene";
import type { DeviceSize } from "../../workspace/types";

/**
 * Stage chrome around the device (toolbar gap and badges), in px.
 */
const STAGE_CHROME = 56;

/**
 * Padding around a phone or tablet.
 */
const DEVICE_PAD = 26;

/**
 * Padding around the desktop preset.
 */
const DESKTOP_PAD = 32;

/**
 * Smallest safeTop of a phone with a dynamic island.
 */
const ISLAND_SAFE_TOP = 59;

/**
 * Smallest safeBottom of a phone with a home bar.
 */
const HOME_BAR_SAFE_BOTTOM = 16;

/**
 * One safe-area band.
 */
export type SafeBand = {
  readonly side: "top" | "right" | "bottom" | "left";
  readonly size: number;
};

/**
 * The fit scale `k = min(1, (stageW − 56 − pad) / W, (stageH − 56 − pad) / H)`, pad 32 for the
 * desktop and 26 otherwise; never below 0.
 *
 * @param stage - The stage size in px.
 * @param stage.w - Stage width.
 * @param stage.h - Stage height.
 * @param device - The resolved device (W×H).
 * @param desktop - True for the desktop preset.
 * @returns The scale.
 * @example
 * ```ts
 * fitScale({ w: 1200, h: 1000 }, { w: 393, h: 852, safe: { top: 59, right: 0, bottom: 34, left: 0 } }, false); // ≈ 1.0775 → 1
 * ```
 */
export function fitScale(
  stage: { readonly w: number; readonly h: number },
  device: DeviceSize,
  desktop: boolean
): number {
  const pad = desktop ? DESKTOP_PAD : DEVICE_PAD;
  const scale = Math.min(
    1,
    (stage.w - STAGE_CHROME - pad) / device.w,
    (stage.h - STAGE_CHROME - pad) / device.h
  );
  return Math.max(0, scale);
}

/**
 * The screen slot size W·k × H·k.
 *
 * @param device - The resolved device.
 * @param scale - The scale.
 * @returns The slot size in px.
 * @example
 * ```ts
 * slotSize({ w: 852, h: 393, safe: { top: 0, right: 59, bottom: 34, left: 59 } }, 0.5); // { w: 426, h: 196.5 }
 * ```
 */
export function slotSize(device: DeviceSize, scale: number): { w: number; h: number } {
  return { w: device.w * scale, h: device.h * scale };
}

/**
 * The strip of the stage, from its right edge, that a drawer floating over its end covers: from
 * the drawer's left edge to the stage's right edge, 0 when they do not meet, never more than the
 * stage width.
 *
 * @param stage - The stage's left and right edges in page px.
 * @param stage.left - Left edge.
 * @param stage.right - Right edge.
 * @param drawerLeft - The drawer's left edge in page px.
 * @returns The covered width in px.
 * @example
 * ```ts
 * drawerCover({ left: 0, right: 480 }, 197); // 283
 * ```
 */
export function drawerCover(
  stage: { readonly left: number; readonly right: number },
  drawerLeft: number
): number {
  const covered = stage.right - Math.max(drawerLeft, stage.left);
  return Math.max(0, covered);
}

/**
 * The hatched bands of the resolved safe insets, top, right, bottom, left; empty sides left out.
 *
 * @param device - The resolved device.
 * @returns The bands.
 * @example
 * ```ts
 * safeBands({ w: 393, h: 852, safe: { top: 59, right: 0, bottom: 34, left: 0 } }); // [{ side: "top", size: 59 }, { side: "bottom", size: 34 }]
 * ```
 */
export function safeBands(device: DeviceSize): readonly SafeBand[] {
  const sides = ["top", "right", "bottom", "left"] as const;
  return sides
    .map((side): SafeBand => ({ side, size: device.safe[side] }))
    .filter(band => band.size > 0);
}

/**
 * True for a phone whose safeTop leaves room for a dynamic island (≥ 59).
 *
 * @param kind - The preset kind.
 * @param safeTop - The preset's safeTop.
 * @returns Whether to draw the island.
 * @example
 * ```ts
 * hasIsland("phone", 59); // true
 * ```
 */
export function hasIsland(kind: "phone" | "tablet" | "desktop", safeTop: number): boolean {
  return kind === "phone" && safeTop >= ISLAND_SAFE_TOP;
}

/**
 * True for a phone whose safeBottom leaves room for a home bar (≥ 16).
 *
 * @param kind - The preset kind.
 * @param safeBottom - The preset's safeBottom.
 * @returns Whether to draw the home bar.
 * @example
 * ```ts
 * hasHomeBar("phone", 34); // true
 * ```
 */
export function hasHomeBar(kind: "phone" | "tablet" | "desktop", safeBottom: number): boolean {
  return kind === "phone" && safeBottom >= HOME_BAR_SAFE_BOTTOM;
}

/**
 * Inline position of a rect in device px (the overlay carries the frame box transform).
 *
 * @param rect - The rect.
 * @returns The style object.
 * @example
 * ```ts
 * rectStyle({ x: 1, y: 2, w: 3, h: 4 }); // { left: "1px", top: "2px", width: "3px", height: "4px" }
 * ```
 */
export function rectStyle(rect: PageRect): Record<string, string> {
  return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` };
}
