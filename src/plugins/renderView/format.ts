/**
 * @file renderView plugin — the pure texts of the scene cards: fixed decimals, the texture use tags
 * and the bounds line of the tree detail. (The metric tiles and their sparkline are gone with
 * Mission control, spec 09 § M1.)
 */
import type { PageRect } from "../panels/shared/scene";
import type { TextureUse } from "./types";

/**
 * Formats a number with fixed decimals.
 *
 * @param value - A number.
 * @param digits - Decimals (2 by default).
 * @returns The text.
 * @example
 * ```ts
 * fixed(4); // "4.00"
 * ```
 */
export function fixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/**
 * A number without trailing zeros, at most one decimal.
 *
 * @param value - A number.
 * @returns The text.
 * @example
 * ```ts
 * short(880.25); // "880.3"
 * ```
 */
function short(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * The tag of a texture use and its `data-use` value.
 *
 * @param use - The derived use.
 * @returns The text and the data value.
 * @example
 * ```ts
 * tagOfUse({ kind: "unused-since", frame: 212 }); // { text: "unused since f212", data: "unused" }
 * ```
 */
export function tagOfUse(use: TextureUse): {
  text: string;
  data: "in-use" | "unused" | "not-seen";
} {
  if (use.kind === "in-use") return { text: "in use", data: "in-use" };
  if (use.kind === "unused-since") return { text: `unused since f${use.frame}`, data: "unused" };
  return { text: `not seen since f${use.since}`, data: "not-seen" };
}

/**
 * The bounds line of the tree detail: `x · y · w×h`.
 *
 * @param rect - The node rect, if placed.
 * @returns The text.
 * @example
 * ```ts
 * boundsText({ x: 55, y: 801, w: 970, h: 970 }); // "55 · 801 · 970×970"
 * ```
 */
export function boundsText(rect: PageRect | undefined): string {
  if (rect === undefined) return "not placed";
  return `${short(rect.x)} · ${short(rect.y)} · ${short(rect.w)}×${short(rect.h)}`;
}
