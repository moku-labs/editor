/**
 * @file flowView camera module — pure camera math: screen = world · z + (x, y). Zoom clamping,
 * zoom at a point, fits, the default camera (M11), focus and follow moves, the dot grid pitch and
 * the log-scale zoom interpolation.
 */
import type { Camera, FlowViewConfig, Item, Rect } from "../types";
import type { ViewInsets, ViewSize } from "./types";

/**
 * Padding and zoom cap of "Fit all".
 */
export const FIT_ALL = { pad: 40, maxZ: 1.4 } as const;

/**
 * Padding and zoom cap of "Fit selection".
 */
export const FIT_SELECTION = { pad: 70, maxZ: 1.3 } as const;

/**
 * Items taller than this are focused by their top 900 units.
 */
const TALL = 200;

/**
 * How much of a tall item a focus move shows.
 */
const TALL_VIEW = 900;

/**
 * Grid pitch in world units.
 */
const GRID = 24;

/**
 * Smallest dot spacing on screen.
 */
const GRID_MIN_PX = 11;

/**
 * Clamps a number into a range.
 *
 * @param value - The number.
 * @param min - Lowest value.
 * @param max - Highest value.
 * @returns The clamped number.
 * @example
 * ```ts
 * clamp(5, 0, 3); // 3
 * ```
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamps a zoom to the configured range (8 %–300 %).
 *
 * @param z - The zoom.
 * @param config - minZoom and maxZoom.
 * @returns The clamped zoom.
 * @example
 * ```ts
 * clampZoom(9, { minZoom: 0.08, maxZoom: 3 }); // 3
 * ```
 */
export function clampZoom(
  z: number,
  config: Pick<Readonly<FlowViewConfig>, "minZoom" | "maxZoom">
): number {
  return clamp(z, config.minZoom, config.maxZoom);
}

/**
 * Zooms by a factor so that the world point under (px, py) stays fixed.
 *
 * @param cam - The camera.
 * @param px - Screen x of the fixed point.
 * @param py - Screen y of the fixed point.
 * @param factor - The zoom factor.
 * @param config - minZoom and maxZoom.
 * @returns The new camera.
 * @example
 * ```ts
 * zoomAt({ x: 0, y: 0, z: 1 }, 100, 100, 2, config); // { x: -100, y: -100, z: 2 }
 * ```
 */
export function zoomAt(
  cam: Camera,
  px: number,
  py: number,
  factor: number,
  config: Pick<Readonly<FlowViewConfig>, "minZoom" | "maxZoom">
): Camera {
  const z = clampZoom(cam.z * factor, config);
  return { x: px - ((px - cam.x) * z) / cam.z, y: py - ((py - cam.y) * z) / cam.z, z };
}

/**
 * The screen rect left for the graph: the viewport minus the insets.
 *
 * @param view - The viewport size.
 * @param insets - The insets.
 * @returns The available rect in screen px.
 * @example
 * ```ts
 * availableRect({ w: 1000, h: 800 }, { top: 0, right: 224, bottom: 0, left: 0 }); // { x: 0, y: 0, w: 776, h: 800 }
 * ```
 */
export function availableRect(view: ViewSize, insets: ViewInsets): Rect {
  return {
    x: insets.left,
    y: insets.top,
    w: Math.max(1, view.w - insets.left - insets.right),
    h: Math.max(1, view.h - insets.top - insets.bottom)
  };
}

/**
 * The camera that shows a world point in the centre of the available rect at a zoom.
 *
 * @param point - The world point.
 * @param point.x - World x.
 * @param point.y - World y.
 * @param z - The zoom.
 * @param view - The viewport size.
 * @param insets - The insets.
 * @returns The camera.
 * @example
 * ```ts
 * centreAt({ x: 10, y: 20 }, 2, { w: 1000, h: 800 }, noInsets); // { x: 480, y: 360, z: 2 }
 * ```
 */
export function centreAt(
  point: { readonly x: number; readonly y: number },
  z: number,
  view: ViewSize,
  insets: ViewInsets
): Camera {
  const area = availableRect(view, insets);
  return { x: area.x + area.w / 2 - point.x * z, y: area.y + area.h / 2 - point.y * z, z };
}

/**
 * Fits a world rect into the available rect with padding, centred.
 *
 * @param rect - The world rect.
 * @param view - The viewport size.
 * @param insets - The insets.
 * @param pad - Padding in px on every side.
 * @param maxZ - Highest zoom of this fit.
 * @param config - minZoom and maxZoom.
 * @returns The camera.
 * @example
 * ```ts
 * fitRect({ x: 0, y: 0, w: 920, h: 360 }, { w: 1000, h: 800 }, noInsets, 40, 1.4, config).z; // 1
 * ```
 */
export function fitRect(
  rect: Rect,
  view: ViewSize,
  insets: ViewInsets,
  pad: number,
  maxZ: number,
  config: Pick<Readonly<FlowViewConfig>, "minZoom" | "maxZoom">
): Camera {
  const area = availableRect(view, insets);
  const fit = Math.min(
    (area.w - 2 * pad) / Math.max(1, rect.w),
    (area.h - 2 * pad) / Math.max(1, rect.h)
  );
  const z = clamp(fit, config.minZoom, maxZ);
  return centreAt({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, z, view, insets);
}

/**
 * The default camera (M11): the frame fitted when that zoom is at least defaultMinZoom; else
 * defaultMinZoom, centred on the current node (or the frame centre without one).
 *
 * @param frame - The current flow's frame.
 * @param current - The current node's rect, if visible.
 * @param view - The viewport size.
 * @param insets - The insets.
 * @param config - minZoom, maxZoom and defaultMinZoom.
 * @returns The camera.
 * @example
 * ```ts
 * defaultCamera({ x: 0, y: 0, w: 4000, h: 3000 }, current, view, noInsets, config).z; // 0.8
 * ```
 */
export function defaultCamera(
  frame: Rect,
  current: Rect | undefined,
  view: ViewSize,
  insets: ViewInsets,
  config: Pick<Readonly<FlowViewConfig>, "minZoom" | "maxZoom" | "defaultMinZoom">
): Camera {
  const fit = fitRect(frame, view, insets, FIT_ALL.pad, FIT_ALL.maxZ, config);
  if (fit.z >= config.defaultMinZoom) return fit;

  const target = current ?? frame;
  const point = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  return centreAt(point, config.defaultMinZoom, view, insets);
}

/**
 * The focus move onto an item: a card keeps a zoom in [1, 1.25] and is centred; a tall item (hub,
 * expanded frame) is zoomed so its top 900 units fit, centred 120 units right so lanes show.
 *
 * @param item - The focused item.
 * @param cam - The current camera.
 * @param view - The viewport size.
 * @param insets - The insets.
 * @returns The camera.
 * @example
 * ```ts
 * focusCamera(card, { x: 0, y: 0, z: 0.5 }, view, noInsets).z; // 1
 * ```
 */
export function focusCamera(item: Item, cam: Camera, view: ViewSize, insets: ViewInsets): Camera {
  if (item.h <= TALL) {
    const point = { x: item.x + item.w / 2, y: item.y + item.h / 2 };
    return centreAt(point, clamp(cam.z, 1, 1.25), view, insets);
  }

  const area = availableRect(view, insets);
  const shown = Math.min(item.h, TALL_VIEW);
  const z = clamp((area.h - 60) / shown, 0.35, 1.05);
  return centreAt({ x: item.x + item.w / 2 + 120, y: item.y + shown / 2 }, z, view, insets);
}

/**
 * The follow move onto the current item: zoom in [0.7, 1.1]; a hub is centred 120 units below
 * its top.
 *
 * @param item - The current item.
 * @param cam - The current camera.
 * @param view - The viewport size.
 * @param insets - The insets.
 * @returns The camera.
 * @example
 * ```ts
 * followCamera(hub, { x: 0, y: 0, z: 2 }, view, noInsets).z; // 1.1
 * ```
 */
export function followCamera(item: Item, cam: Camera, view: ViewSize, insets: ViewInsets): Camera {
  const y = item.kind === "hub" ? item.y + 120 : item.y + item.h / 2;
  return centreAt({ x: item.x + item.w / 2, y }, clamp(cam.z, 0.7, 1.1), view, insets);
}

/**
 * The dot grid pitch on screen: 24 world units, ×4 while under 11 px.
 *
 * @param z - The zoom.
 * @returns The pitch in px.
 * @example
 * ```ts
 * gridStep(0.1); // 38.4
 * ```
 */
export function gridStep(z: number): number {
  let step = GRID * z;
  while (step < GRID_MIN_PX) step *= 4;
  return step;
}

/**
 * Interpolates a zoom in log scale: z0 · (z1 / z0)^t.
 *
 * @param z0 - Start zoom.
 * @param z1 - End zoom.
 * @param t - Progress 0…1.
 * @returns The zoom at t.
 * @example
 * ```ts
 * logLerp(0.5, 2, 0.5); // 1
 * ```
 */
export function logLerp(z0: number, z1: number, t: number): number {
  return z0 * (z1 / z0) ** t;
}
