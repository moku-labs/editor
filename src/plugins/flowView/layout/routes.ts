/**
 * @file flowView layout module — orthogonal routes with rounded corners: the 3-segment route of
 * pinned and dragged items, the edge anchors, the SVG path and the re-route of the edges touching
 * one moved item.
 */
import type { EdgePath, Item, ItemKey } from "../types";
import { HUB_HEAD } from "./types";

/**
 * A point.
 */
type Point = { readonly x: number; readonly y: number };

/**
 * How far a route steps out before it turns back to a target on its left.
 */
const STEP_OUT = 24;

/**
 * An orthogonal route: a straight line on one row, else three segments through the middle column
 * (or 24 units right of the source when the target is on its left).
 *
 * @param from - Start point.
 * @param from.x - Start x.
 * @param from.y - Start y.
 * @param to - End point.
 * @param to.x - End x.
 * @param to.y - End y.
 * @returns The route points.
 * @example
 * ```ts
 * orthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 50 }); // [{0,0}, {50,0}, {50,50}, {100,50}]
 * ```
 */
export function orthogonalRoute(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number }
): readonly { x: number; y: number }[] {
  if (from.y === to.y) return [{ ...from }, { ...to }];

  const middle = to.x > from.x + STEP_OUT ? (from.x + to.x) / 2 : from.x + STEP_OUT;
  return [{ ...from }, { x: middle, y: from.y }, { x: middle, y: to.y }, { ...to }];
}

/**
 * Rounds a coordinate to 2 decimals for the SVG path.
 *
 * @param value - A coordinate.
 * @returns The rounded number.
 * @example
 * ```ts
 * fixed(1.234_56); // 1.23
 * ```
 */
function fixed(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The point at a distance from `from` towards `to`.
 *
 * @param from - Start.
 * @param to - Direction.
 * @param distance - Distance along the segment.
 * @returns The point.
 * @example
 * ```ts
 * toward({ x: 0, y: 0 }, { x: 10, y: 0 }, 3); // { x: 3, y: 0 }
 * ```
 */
function toward(from: Point, to: Point, distance: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return {
    x: from.x + ((to.x - from.x) * distance) / length,
    y: from.y + ((to.y - from.y) * distance) / length
  };
}

/**
 * An SVG path through the points with every corner rounded (radius capped at half of each
 * adjacent segment).
 *
 * @param points - Route points.
 * @param radius - Corner radius (8).
 * @returns The `d` attribute.
 * @example
 * ```ts
 * roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], 8); // "M 0 0 L 92 0 Q 100 0 100 8 L 100 50"
 * ```
 */
export function roundedPath(
  points: readonly { readonly x: number; readonly y: number }[],
  radius: number
): string {
  const [first] = points;
  if (first === undefined) return "";

  const parts = [`M ${fixed(first.x)} ${fixed(first.y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? first;
    const corner = points[index] ?? first;
    const next = points[index + 1] ?? corner;
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, before / 2, after / 2);
    const start = toward(corner, previous, r);
    const end = toward(corner, next, r);
    parts.push(
      `L ${fixed(start.x)} ${fixed(start.y)}`,
      `Q ${fixed(corner.x)} ${fixed(corner.y)} ${fixed(end.x)} ${fixed(end.y)}`
    );
  }
  const last = points.at(-1) ?? first;
  if (points.length > 1) parts.push(`L ${fixed(last.x)} ${fixed(last.y)}`);
  return parts.join(" ");
}

/**
 * Where an edge leaves an item: its right side at the outcome's port (else its middle).
 *
 * @param item - The source item.
 * @param outcome - The outcome.
 * @returns The point.
 * @example
 * ```ts
 * anchorOut(hub, "tap"); // { x: hub.x + 200, y: hub.y + 100 }
 * ```
 */
export function anchorOut(item: Item, outcome: string): { x: number; y: number } {
  const offset = item.ports?.[outcome] ?? item.h / 2;
  return { x: item.x + item.w, y: item.y + offset };
}

/**
 * Where an edge enters an item: the centre of a port, the middle of a hub head, else the left
 * middle.
 *
 * @param item - The target item.
 * @returns The point.
 */
export function anchorIn(item: Item): { x: number; y: number } {
  if (item.kind === "port") return { x: item.x + item.w / 2, y: item.y + item.h / 2 };
  if (item.kind === "hub") return { x: item.x, y: item.y + HUB_HEAD / 2 };
  return { x: item.x, y: item.y + item.h / 2 };
}

/**
 * Re-routes the edges that touch one moved item with the 3-segment route; every other edge is kept
 * as it is (same object).
 *
 * @param edges - The edges.
 * @param byKey - Items by key, with the moved item at its new place.
 * @param key - The moved item.
 * @returns The edges and how many were re-routed.
 * @example
 * ```ts
 * rerouteTouching(result.edges, { ...result.byKey, [key]: moved }, key).rerouted; // 2
 * ```
 */
export function rerouteTouching(
  edges: readonly EdgePath[],
  byKey: Readonly<Record<ItemKey, Item>>,
  key: ItemKey
): { readonly edges: EdgePath[]; readonly rerouted: number } {
  let rerouted = 0;
  const next = edges.map(edge => {
    if (edge.from !== key && edge.to !== key) return edge;
    const from = byKey[edge.from];
    const to = edge.to === undefined ? undefined : byKey[edge.to];
    if (from === undefined || to === undefined) return edge;
    rerouted += 1;
    return { ...edge, points: orthogonalRoute(anchorOut(from, edge.outcome), anchorIn(to)) };
  });
  return { edges: next, rerouted };
}
