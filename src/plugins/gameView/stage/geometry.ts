/**
 * @file gameView plugin — stage geometry (pure): the device frame and its bezel (round 2b R9),
 * the fit scale of the device in the stage and the one scale every preset of a kind shares, the
 * slot size, the strip of the stage a floating drawer covers, the safe-area bands of a resolved
 * device, the dynamic island and home bar rules, and the inline position of a rect in device px.
 * Sizes and insets come from workspace's resolveDevice (R8); gameView has no rule of its own.
 */
import type { PageRect } from "../../panels/shared/scene";
import type { DeviceSpec } from "../../registry/protocol";
import { resolveDevice } from "../../workspace/devices";
import type { DeviceSize, Orientation } from "../../workspace/types";

/**
 * Stage chrome around the device (toolbar gap and badges), in px.
 */
const STAGE_CHROME = 56;

/**
 * Room around a framed phone or tablet, beyond its bezel.
 */
const DEVICE_MARGIN = 6;

/**
 * Padding around the desktop preset.
 */
const DESKTOP_PAD = 32;

/**
 * The bezel of a modern phone or a tablet: 10 px all round.
 */
const MODERN_BEZEL: Bezel = { top: 10, right: 10, bottom: 10, left: 10 };

/**
 * The bezel above and below a home-button screen (round 2b R9).
 */
const HOME_BUTTON_BEZEL = 64;

/**
 * No bezel: the desktop preset.
 */
const NO_BEZEL: Bezel = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The frame drawn around a screen: a modern phone (thin bezel, island) or a phone with a home
 * button (tall bezels above and below, a round button in the bottom one, square screen).
 */
export type DeviceFrame = DeviceSpec["frame"];

/**
 * The bezel around the screen slot, in stage px (not scaled with the screen).
 */
export type Bezel = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

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
 * The frame of a preset (`DeviceSpec.frame`): the home-button one, else modern.
 *
 * @param preset - The device preset.
 * @returns The frame.
 * @example
 * ```ts
 * frameOf(presetOf("iphone-15")); // "modern"
 * ```
 */
export function frameOf(preset: DeviceSpec): DeviceFrame {
  return preset.frame === "home-button" ? "home-button" : "modern";
}

/**
 * The bezel of a preset in an orientation: nothing for the desktop, 10 px all round for a modern
 * frame, 64 px above and below a home-button screen with 10 px at its sides. Landscape turns the
 * home-button bezels to the left and the right.
 *
 * @param preset - The device preset.
 * @param orientation - Portrait or landscape.
 * @returns The bezel in stage px.
 * @example
 * ```ts
 * bezelOf(presetOf("iphone-15"), "portrait"); // { top: 10, right: 10, bottom: 10, left: 10 }
 * ```
 */
export function bezelOf(preset: DeviceSpec, orientation: Orientation): Bezel {
  if (preset.kind === "desktop") return NO_BEZEL;
  if (frameOf(preset) === "modern") return MODERN_BEZEL;

  const side = MODERN_BEZEL.left;
  const tall = HOME_BUTTON_BEZEL;
  return orientation === "portrait"
    ? { top: tall, right: side, bottom: tall, left: side }
    : { top: side, right: tall, bottom: side, left: tall };
}

/**
 * The fit scale `k = min(1, (stageW − 56 − padW) / W, (stageH − 56 − padH) / H)`: the pad is 32
 * for the desktop, otherwise 6 plus the bezel on that axis (26 with the modern bezel); never
 * below 0.
 *
 * @param stage - The stage size in px.
 * @param stage.w - Stage width.
 * @param stage.h - Stage height.
 * @param device - The resolved device (W×H).
 * @param desktop - True for the desktop preset.
 * @param bezel - The bezel around the screen; the modern one by default.
 * @returns The scale.
 * @example
 * ```ts
 * fitScale({ w: 1200, h: 1000 }, { w: 393, h: 852, safe: { top: 59, right: 0, bottom: 34, left: 0 } }, false); // ≈ 1.0775 → 1
 * ```
 */
export function fitScale(
  stage: { readonly w: number; readonly h: number },
  device: DeviceSize,
  desktop: boolean,
  bezel: Bezel = MODERN_BEZEL
): number {
  const padW = desktop ? DESKTOP_PAD : DEVICE_MARGIN + bezel.left + bezel.right;
  const padH = desktop ? DESKTOP_PAD : DEVICE_MARGIN + bezel.top + bezel.bottom;
  const scale = Math.min(
    1,
    (stage.w - STAGE_CHROME - padW) / device.w,
    (stage.h - STAGE_CHROME - padH) / device.h
  );
  return Math.max(0, scale);
}

/**
 * The one Fit scale of every preset of a kind (round 2b R9): the scale that fits the tallest of
 * them, bezel included, so a small phone shows smaller than a big one. Foldables are phones;
 * tablets and the desktop have their own. It is the smallest fit of the kind's presets and of the
 * screen shown, so a screen the list does not hold (an unfolded inner screen) still fits.
 *
 * @param stage - The stage size in px.
 * @param stage.w - Stage width.
 * @param stage.h - Stage height.
 * @param presets - Every preset (`workspace.devices()`).
 * @param current - The screen shown (`workspace.device().preset`).
 * @param orientation - The orientation.
 * @returns The scale.
 * @example
 * ```ts
 * kindScale({ w: 1200, h: 900 }, DEVICES, presetOf("iphone-se"), "portrait"); // ≈ 0.814, the Galaxy Z Flip 6's
 * ```
 */
export function kindScale(
  stage: { readonly w: number; readonly h: number },
  presets: readonly DeviceSpec[],
  current: DeviceSpec,
  orientation: Orientation
): number {
  const desktop = current.kind === "desktop";
  const scaleOf = (preset: DeviceSpec): number =>
    fitScale(stage, resolveDevice(preset, orientation), desktop, bezelOf(preset, orientation));
  const peers = presets.filter(preset => preset.kind === current.kind);
  return Math.min(scaleOf(current), ...peers.map(preset => scaleOf(preset)));
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
 * True for a modern phone whose safeTop leaves room for a dynamic island (≥ 59); a home-button
 * phone has none.
 *
 * @param kind - The preset kind.
 * @param safeTop - The preset's safeTop.
 * @param frame - The preset's frame; modern by default.
 * @returns Whether to draw the island.
 * @example
 * ```ts
 * hasIsland("phone", 59); // true
 * ```
 */
export function hasIsland(
  kind: "phone" | "tablet" | "desktop",
  safeTop: number,
  frame: DeviceFrame = "modern"
): boolean {
  return kind === "phone" && frame === "modern" && safeTop >= ISLAND_SAFE_TOP;
}

/**
 * True for a modern phone whose safeBottom leaves room for a home bar (≥ 16); a home-button
 * phone has its button instead.
 *
 * @param kind - The preset kind.
 * @param safeBottom - The preset's safeBottom.
 * @param frame - The preset's frame; modern by default.
 * @returns Whether to draw the home bar.
 * @example
 * ```ts
 * hasHomeBar("phone", 34); // true
 * ```
 */
export function hasHomeBar(
  kind: "phone" | "tablet" | "desktop",
  safeBottom: number,
  frame: DeviceFrame = "modern"
): boolean {
  return kind === "phone" && frame === "modern" && safeBottom >= HOME_BAR_SAFE_BOTTOM;
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
