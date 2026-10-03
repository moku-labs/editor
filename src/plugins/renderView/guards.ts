/**
 * @file renderView plugin — the pure guards that narrow game.render, game.assets and game.effects
 * from Json.
 */
import { isJsonObject, numberOf, stringOf } from "../panels/shared/scene/wire";
import type { Json } from "../registry/protocol";
import type { AssetsUsage, EffectsStats, RenderStats } from "./types";

/**
 * The fields of RenderStats that are always numbers.
 */
const STAT_FIELDS = ["fps", "frameMs", "textures", "textureMb", "views", "pooled"] as const;

/**
 * The fields of EffectsStats, all non-negative numbers.
 */
const EFFECT_FIELDS = ["particles", "emitters", "filters", "renderPasses"] as const;

/**
 * Narrows a game.render value: six numbers, plus renderPasses and drawCalls when they are numbers.
 *
 * @param value - The watched value.
 * @returns The stats, or undefined for another shape.
 * @example
 * ```ts
 * asRenderStats({ fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25, views: 180, pooled: 24 })?.fps; // 60
 * asRenderStats({ fps: "60" }); // undefined
 * ```
 */
export function asRenderStats(value: Json): RenderStats | undefined {
  if (!isJsonObject(value)) return undefined;

  const numbers: number[] = [];
  for (const field of STAT_FIELDS) {
    const number = numberOf(value[field]);
    if (number === undefined) return undefined;
    numbers.push(number);
  }

  const [fps = 0, frameMs = 0, textures = 0, textureMb = 0, views = 0, pooled = 0] = numbers;
  const stats: RenderStats = { fps, frameMs, textures, textureMb, views, pooled };
  const renderPasses = numberOf(value.renderPasses);
  if (renderPasses !== undefined) stats.renderPasses = renderPasses;
  const drawCalls = numberOf(value.drawCalls);
  if (drawCalls !== undefined) stats.drawCalls = drawCalls;
  return stats;
}

/**
 * Narrows a game.effects value (game 0.0.3): four finite non-negative numbers.
 *
 * @param value - The watched value.
 * @returns The effects, or undefined for another shape.
 * @example
 * ```ts
 * asEffectsStats({ particles: 18, emitters: 1, filters: 24, renderPasses: 49 })?.particles; // 18
 * asEffectsStats({ particles: -1, emitters: 1, filters: 24, renderPasses: 49 }); // undefined
 * ```
 */
export function asEffectsStats(value: Json): EffectsStats | undefined {
  if (!isJsonObject(value)) return undefined;

  const numbers: number[] = [];
  for (const field of EFFECT_FIELDS) {
    const number = numberOf(value[field]);
    if (number === undefined || number < 0) return undefined;
    numbers.push(number);
  }

  const [particles = 0, emitters = 0, filters = 0, renderPasses = 0] = numbers;
  return { particles, emitters, filters, renderPasses };
}

/**
 * Narrows one bundle entry of game.assets.
 *
 * @param value - One entry.
 * @returns The entry, or undefined for another shape.
 * @example
 * ```ts
 * bundleOf({ name: "board", tier: "scene", mb: 3.5, lastUsed: 12 })?.mb; // 3.5
 * ```
 */
function bundleOf(value: Json): AssetsUsage["bundles"][number] | undefined {
  if (!isJsonObject(value)) return undefined;

  const name = stringOf(value.name);
  const tier = stringOf(value.tier);
  const mb = numberOf(value.mb);
  const lastUsed = numberOf(value.lastUsed);
  if (name === undefined || tier === undefined) return undefined;
  if (mb === undefined || lastUsed === undefined) return undefined;
  return { name, tier, mb, lastUsed };
}

/**
 * Narrows a game.assets value: textureMb, budgetMb and well-formed bundle entries.
 *
 * @param value - The watched value.
 * @returns The usage, or undefined for another shape.
 * @example
 * ```ts
 * asAssetsUsage({ textureMb: 3.5, budgetMb: 192, bundles: [{ name: "board", tier: "scene", mb: 3.5, lastUsed: 12 }] })?.bundles.length; // 1
 * asAssetsUsage({ textureMb: 3.5 }); // undefined
 * ```
 */
export function asAssetsUsage(value: Json): AssetsUsage | undefined {
  if (!isJsonObject(value) || !Array.isArray(value.bundles)) return undefined;

  const textureMb = numberOf(value.textureMb);
  const budgetMb = numberOf(value.budgetMb);
  if (textureMb === undefined || budgetMb === undefined) return undefined;

  const bundles: AssetsUsage["bundles"][number][] = [];
  for (const entry of value.bundles) {
    const bundle = bundleOf(entry);
    if (bundle === undefined) return undefined;
    bundles.push(bundle);
  }
  return { textureMb, budgetMb, bundles };
}
