/**
 * @file flowView camera module — pure geometry of the canvas chrome: the insets of the preview zone
 * (the pinned preview floats clear of the breadcrumb, the toolbar, the zoom bar, the minimap and
 * an open Inspector drawer) and the world point that brings a keyboard-focused item back into the
 * clipped canvas.
 */
import type { PreviewCorner } from "../../workspace/types";
import type { Camera } from "../types";
import type { ViewSize } from "./types";

/**
 * Height of the breadcrumb and toolbar band at the top, and of the zoom bar band at the bottom.
 */
export const CHROME_BAND = 56;

/**
 * Margin the workspace keeps between the preview float and its zone edge (workspace dock).
 */
const FLOAT_MARGIN = 12;

/**
 * Outer box of the minimap: the 200×128 map and its 1 px border (minimap.css).
 */
const MINIMAP_BOX = { w: 202, h: 130 } as const;

/**
 * Gap between the minimap and the canvas right and bottom edges (minimap.css).
 */
const MINIMAP_OFFSET = 12;

/**
 * Minimap bottom on a narrow canvas: above the zoom bar row (minimap.css container query).
 */
const MINIMAP_OFFSET_NARROW = 56;

/**
 * Widest canvas in px on which the minimap sits above the zoom bar row (minimap.css).
 */
const NARROW_CANVAS = 480;

/**
 * The widest share of its container a side-panel drawer takes (side-panel.css `max-inline-size`).
 */
const DRAWER_MAX_SHARE = 0.92;

/**
 * What the zone insets read of the preview: its corner and its float size in px.
 */
export type ZonePreview = {
  readonly corner: PreviewCorner;
  readonly width: number;
  readonly height: number;
};

/**
 * Insets of the preview zone inside the canvas, in px.
 */
export type ZoneInsets = { readonly top: number; readonly bottom: number };

/**
 * A rect in client px (a DOMRect fits).
 */
export type ScreenBox = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

/**
 * True when a float in a bottom corner shares columns with the minimap (bottom-right always; a
 * bottom-left float on a canvas too narrow for both side by side).
 *
 * @param canvasW - The canvas width in px.
 * @param preview - Corner and float size of the preview.
 * @returns Whether the float would sit over or under the minimap.
 */
function sharesMinimapColumn(canvasW: number, preview: ZonePreview): boolean {
  if (!preview.corner.startsWith("bottom")) return false;
  if (preview.corner.endsWith("right")) return true;
  const floatRight = FLOAT_MARGIN + preview.width;
  return floatRight > canvasW - MINIMAP_OFFSET - MINIMAP_BOX.w;
}

/**
 * The insets of the preview zone: the top band always; at the bottom the zoom bar band, raised
 * above the minimap when the float shares its columns, so the two never overlap. The raise stops
 * where the float would reach the top band (a tall float on a short canvas).
 *
 * @param canvas - The canvas size in px.
 * @param preview - Corner and float size of the preview.
 * @returns The top and bottom insets.
 * @example
 * ```ts
 * // A 720 px window: the 368 px canvas lifts the minimap to 56 px; S floats 12 px above it.
 * previewZoneInsets({ w: 368, h: 856 }, { corner: "bottom-right", width: 150, height: 280 }); // { top: 56, bottom: 186 }
 * ```
 */
export function previewZoneInsets(canvas: ViewSize, preview: ZonePreview): ZoneInsets {
  if (!sharesMinimapColumn(canvas.w, preview)) return { top: CHROME_BAND, bottom: CHROME_BAND };

  const isNarrow = canvas.w > 0 && canvas.w <= NARROW_CANVAS;
  const mapTop = (isNarrow ? MINIMAP_OFFSET_NARROW : MINIMAP_OFFSET) + MINIMAP_BOX.h;
  const room = canvas.h - CHROME_BAND - 2 * FLOAT_MARGIN - preview.height;
  return { top: CHROME_BAND, bottom: Math.max(CHROME_BAND, Math.min(mapTop, room)) };
}

/**
 * How far an open drawer at the right edge of its container reaches into the canvas: the drawer
 * width, never more than 92 % of the container (side-panel.css), counted from the container's
 * right edge; only the part over the canvas.
 *
 * @param canvas - The canvas rect in client px.
 * @param canvas.right - Its right edge.
 * @param container - The rect of the drawer's container (the Flow workspace) in client px.
 * @param container.right - Its right edge.
 * @param container.width - Its width.
 * @param drawer - The drawer width in px; undefined while no drawer is open.
 * @returns The right inset of the preview zone in px; 0 when the drawer misses the canvas.
 * @example
 * ```ts
 * // The 480 px window: a 436 px canvas and the 240 px Inspector drawer over its right part.
 * drawerInset({ right: 480 }, { right: 480, width: 436 }, 240); // 240
 * ```
 */
export function drawerInset(
  canvas: { readonly right: number },
  container: { readonly right: number; readonly width: number },
  drawer: number | undefined
): number {
  if (drawer === undefined) return 0;

  const width = Math.min(drawer, container.width * DRAWER_MAX_SHARE);
  return Math.max(0, canvas.right - (container.right - width));
}

/**
 * The world point to centre on so a focused element shows: its centre, when any part of it is
 * outside the canvas box; undefined when it is fully inside.
 *
 * @param target - The focused element's rect in client px.
 * @param canvas - The canvas rect in client px.
 * @param cam - The camera: screen = world · z + (x, y), relative to the canvas.
 * @returns The world point, or undefined.
 * @example
 * ```ts
 * const canvas = { left: 0, top: 0, right: 400, bottom: 300 };
 * revealPoint({ left: 500, top: 100, right: 672, bottom: 146 }, canvas, { x: 0, y: 0, z: 1 }); // { x: 586, y: 123 }
 * ```
 */
export function revealPoint(
  target: ScreenBox,
  canvas: ScreenBox,
  cam: Camera
): { readonly x: number; readonly y: number } | undefined {
  const isInside =
    target.left >= canvas.left &&
    target.top >= canvas.top &&
    target.right <= canvas.right &&
    target.bottom <= canvas.bottom;
  if (isInside) return undefined;
  const screenX = (target.left + target.right) / 2 - canvas.left;
  const screenY = (target.top + target.bottom) / 2 - canvas.top;
  return { x: (screenX - cam.x) / cam.z, y: (screenY - cam.y) / cam.z };
}
