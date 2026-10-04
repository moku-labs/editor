/**
 * @file Shared view module — scene: the drawn rect of a ui node through its fit chain, and the
 * rest transform of its style on top (the game's pivotOf + restTransform, ui/layout/motion.ts).
 */
import type { Json } from "../../../registry/protocol";
import type { PageRect, SceneNode } from "./types";
import { isJsonObject, numberOf } from "./wire";

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

/**
 * A 2-D affine map in root units: `(x, y) ↦ (a·x + c·y + e, b·x + d·y + f)`. The rest transform of
 * a ui node, and the ones of its ancestors composed onto it.
 */
export type RestMap = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

/**
 * A point in the units of a box.
 */
type Point = { readonly x: number; readonly y: number };

/**
 * The game's rest pose of a ui node on its drawn box: `position` is where the pivot lands in the
 * parent's units, the box turns by `rotation` and scales by `scale` around the pivot.
 */
type RestPose = {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
  readonly pivot: Point;
};

/**
 * The point a box turns and scales around, from the `origin` of its style: the game's `pivotOf`
 * (ui/layout/motion.ts). The centre when the style names none, or names one the game does not know.
 *
 * @param origin - The style's `origin`: `"center"`, `"top"`, `"topLeft"` or `{ x, y }` fractions.
 * @param width - The width of the box.
 * @param height - The height of the box.
 * @returns The pivot in the box's own units.
 * @example
 * ```ts
 * pivotOf("top", 200, 80); // { x: 100, y: 0 }
 * ```
 */
function pivotOf(origin: Json | undefined, width: number, height: number): Point {
  if (origin === "top") return { x: width / 2, y: 0 };
  if (origin === "topLeft") return { x: 0, y: 0 };

  if (isJsonObject(origin)) {
    const x = numberOf(origin.x);
    const y = numberOf(origin.y);

    if (x !== undefined && y !== undefined) return { x: x * width, y: y * height };
  }

  return { x: width / 2, y: height / 2 };
}

/**
 * The rest pose of a ui node: the game's `restTransform` (ui/layout/motion.ts) on the drawn box.
 * The fit is already in the drawn box, so it only scales the offsets here. A style with no offset,
 * scale or rotation has no pose: its `origin` alone moves nothing.
 *
 * @param rect - The drawn rect of the node in root units.
 * @param parent - The drawn rect of its parent, or undefined for a root.
 * @param style - The node's style.
 * @param fit - The scale the node is drawn at.
 * @returns The pose relative to the parent, or undefined for the identity.
 * @example
 * ```ts
 * restPoseOf({ x: 0, y: 0, w: 200, h: 80 }, undefined, { rotation: -0.026, origin: "top" }, 1);
 * // { x: 100, y: 0, rotation: -0.026, scale: 1, pivot: { x: 100, y: 0 } }
 * ```
 */
function restPoseOf(
  rect: PageRect,
  parent: PageRect | undefined,
  style: SceneNode["style"],
  fit: number
): RestPose | undefined {
  const offsetX = numberOf(style?.offsetX) ?? 0;
  const offsetY = numberOf(style?.offsetY) ?? 0;
  const scale = numberOf(style?.scale) ?? 1;
  const rotation = numberOf(style?.rotation) ?? 0;

  if (offsetX === 0 && offsetY === 0 && scale === 1 && rotation === 0) return undefined;

  const pivot = pivotOf(style?.origin, rect.w, rect.h);
  const local = { x: rect.x - (parent?.x ?? 0), y: rect.y - (parent?.y ?? 0) };

  return {
    x: local.x + pivot.x + fit * offsetX,
    y: local.y + pivot.y + fit * offsetY,
    rotation,
    scale,
    pivot
  };
}

/**
 * The map of a ui node's rest transform in root units: what the game's `Transform` does to the
 * drawn box, the parent's corner put back. Undefined when the style moves nothing.
 *
 * @param rect - The drawn rect of the node in root units (drawnRect).
 * @param parent - The drawn rect of its parent, or undefined for a root.
 * @param style - The node's style: `origin`, `offsetX`, `offsetY`, `scale`, `rotation` (radians).
 * @param fit - The scale the node is drawn at (fitScaleOf its fit chain): it scales the offsets.
 * @returns The map, or undefined for the identity.
 * @example
 * ```ts
 * restMapOf({ x: 100, y: 200, w: 300, h: 100 }, undefined, { scale: 1.2, origin: "top" }, 1);
 * // { a: 1.2, b: 0, c: -0, d: 1.2, e: -50, f: -40 }: (x, y) ↦ (1.2·x − 50, 1.2·y − 40)
 * ```
 */
export function restMapOf(
  rect: PageRect,
  parent: PageRect | undefined,
  style: SceneNode["style"],
  fit: number
): RestMap | undefined {
  const pose = restPoseOf(rect, parent, style, fit);

  if (pose === undefined) return undefined;

  // A root point X sits at X − rect.xy in the box; the pose takes it to
  // parent.xy + position + R·scale·(X − rect.xy − pivot).
  const cos = Math.cos(pose.rotation) * pose.scale;
  const sin = Math.sin(pose.rotation) * pose.scale;
  const pivotX = rect.x + pose.pivot.x;
  const pivotY = rect.y + pose.pivot.y;
  const landX = (parent?.x ?? 0) + pose.x;
  const landY = (parent?.y ?? 0) + pose.y;

  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: landX - (cos * pivotX - sin * pivotY),
    f: landY - (sin * pivotX + cos * pivotY)
  };
}

/**
 * Composes two maps: `inner` first, then `outer`.
 *
 * @param outer - The map applied second (an ancestor's).
 * @param inner - The map applied first (the node's own).
 * @returns `outer ∘ inner`.
 * @example
 * ```ts
 * composeMaps(parentMap, ownMap); // the node's own transform, then its parent's
 * ```
 */
export function composeMaps(outer: RestMap, inner: RestMap): RestMap {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f
  };
}

/**
 * The axis-aligned box of a rect taken through a map: the bounds of its four corners.
 *
 * @param map - The map.
 * @param rect - A rect in root units.
 * @returns The box around the mapped rect.
 * @example
 * ```ts
 * boundsOf({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, { x: 1, y: 1, w: 10, h: 5 }); // { x: 2, y: 2, w: 20, h: 10 }
 * ```
 */
export function boundsOf(map: RestMap, rect: PageRect): PageRect {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h }
  ].map(({ x, y }) => ({ x: map.a * x + map.c * y + map.e, y: map.b * x + map.d * y + map.f }));
  const xs = corners.map(corner => corner.x);
  const ys = corners.map(corner => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

/**
 * The drawn rect of a ui node with the rest transform of its style on top: the axis-aligned box of
 * the game's `restTransform` (ui/layout/motion.ts). The pivot comes from `origin` (the centre by
 * default, `"top"`, `"topLeft"` or `{ x, y }` fractions of the box); the offsets, the scale and the
 * rotation (radians, clockwise) apply around it. The identity when the style has none of them.
 *
 * @param rect - The drawn rect of the node in root units (after drawnRect).
 * @param parent - The drawn rect of its parent, or undefined for a root. The game's pose is
 *   relative to it; the box in root units is not.
 * @param style - The node's style.
 * @param fit - The scale the node is drawn at (the product of its fit chain): it scales the offsets.
 * @returns The box the node is drawn in, at rest.
 * @example
 * ```ts
 * transformedRect({ x: 100, y: 200, w: 300, h: 100 }, undefined, { scale: 1.2, origin: "top" }, 1);
 * // { x: 70, y: 200, w: 360, h: 120 }
 * transformedRect({ x: 0, y: 0, w: 100, h: 50 }, undefined, { rotation: Math.PI / 2 }, 1);
 * // { x: 25, y: -25, w: 50, h: 100 } (to rounding)
 * ```
 */
export function transformedRect(
  rect: PageRect,
  parent: PageRect | undefined,
  style: SceneNode["style"],
  fit: number
): PageRect {
  const map = restMapOf(rect, parent, style, fit);

  return map === undefined ? rect : boundsOf(map, rect);
}
