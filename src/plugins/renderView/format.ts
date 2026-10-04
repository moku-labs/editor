/**
 * @file renderView plugin — the pure texts of the Render workspace: the metric tiles, the
 * sparkline points, the texture use tags and the bounds line. What the game does not report is
 * named; the JS heap tile is left out where the page reports no heap. A game without the effects
 * plugin reads "Effects not installed in this game" on the Scene tile.
 */
import type { PageRect } from "../panels/shared/scene";
import type { EffectsStats, MetricTiles, TextureUse } from "./types";

/**
 * What one metric tile shows.
 */
export type TileView = {
  readonly id: "fps" | "frame" | "draws" | "textures" | "scene" | "heap";
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly sub: string;
  /** A second sub-line (the Scene tile's effects line), if any. */
  readonly note: string | undefined;
  /** The warn line (unused textures), if any. */
  readonly warn: string | undefined;
  /** The game does not report this value. */
  readonly absent: boolean;
  readonly aria: string | undefined;
};

/**
 * The value of a tile while its source has not delivered.
 */
const WAITING = "—";

/**
 * The Draw calls value when game.render reports no draw counter.
 */
const NOT_COUNTED = "Not counted in a production build";

/**
 * The Scene tile's effects line on a game without game.effects (older than 0.0.3).
 */
const NO_EFFECTS = "Particles and filters are not reported (follow-up F-R1)";

/**
 * The Scene tile's effects line on a game without the effects plugin (game.effects not installed).
 */
const EFFECTS_NOT_INSTALLED = "Effects not installed in this game";

/**
 * The FPS sub-line while the game rests at its idle rate (D-28).
 */
const RESTING = "Resting at 30 fps: nothing moved for 2 s (game time.idleFps)";

/**
 * The fps band of the game's idle rate: game time rests at 30 fps after 2 s without a change.
 */
const IDLE_FPS = { min: 28, max: 32 } as const;

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
 * A count and its noun, singular for exactly one.
 *
 * @param count - The count.
 * @param one - The noun for one.
 * @param many - The noun for any other count.
 * @returns The text.
 * @example
 * ```ts
 * counted(1, "render pass", "render passes"); // "1 render pass"
 * ```
 */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A tile waiting for its source.
 *
 * @param id - The tile.
 * @param label - Its label.
 * @param sub - What it waits for.
 * @returns The view.
 * @example
 * ```ts
 * waiting("fps", "FPS", "Waiting for game.render").value; // "—"
 * ```
 */
function waiting(id: TileView["id"], label: string, sub: string): TileView {
  return {
    id,
    label,
    value: WAITING,
    unit: "",
    sub,
    note: undefined,
    warn: undefined,
    absent: false,
    aria: undefined
  };
}

/**
 * A tile with a value.
 *
 * @param id - The tile.
 * @param label - Its label.
 * @param value - The big value.
 * @param unit - Its unit.
 * @param sub - The sub-line.
 * @returns The view.
 * @example
 * ```ts
 * shown("frame", "Frame time", "3.4", "ms", "Phase split not reported by game.render").unit; // "ms"
 * ```
 */
function shown(
  id: TileView["id"],
  label: string,
  value: string,
  unit: string,
  sub: string
): TileView {
  return {
    id,
    label,
    value,
    unit,
    sub,
    note: undefined,
    warn: undefined,
    absent: false,
    aria: undefined
  };
}

/**
 * The draw calls tile: the counter, or "Not counted in a production build". The sub-line names
 * the render passes when game.render reports them (game 0.0.3).
 *
 * @param draws - The tile data.
 * @returns The view.
 * @example
 * ```ts
 * drawsView({ kind: "absent" }).value; // "Not counted in a production build"
 * drawsView({ kind: "value", value: 14, renderPasses: 1 }).sub; // "1 render pass"
 * ```
 */
function drawsView(draws: MetricTiles["drawCalls"]): TileView {
  const label = "Draw calls";
  if (draws === undefined) return waiting("draws", label, "Waiting for game.render");
  const passes =
    draws.renderPasses === undefined
      ? undefined
      : counted(draws.renderPasses, "render pass", "render passes");
  if (draws.kind === "value") {
    return shown("draws", label, String(draws.value), "per frame", passes ?? "game.render");
  }
  return {
    ...shown("draws", label, NOT_COUNTED, "", passes ?? "game.render reports no draw counter"),
    absent: true,
    aria: "Draw calls: not counted in a production build"
  };
}

/**
 * The Scene tile's effects line: the counts (game 0.0.3), what an older game does not report, or
 * that the game has no effects plugin.
 *
 * @param effects - The game.effects value, if delivered.
 * @param installed - False when the game has no effects plugin.
 * @returns The line.
 * @example
 * ```ts
 * effectsLine({ particles: 18, emitters: 1, filters: 24, renderPasses: 49 }, true); // "18 particles · 1 emitter · 24 filters"
 * effectsLine(undefined, false); // "Effects not installed in this game"
 * ```
 */
function effectsLine(effects: EffectsStats | undefined, installed: boolean): string {
  if (!installed) return EFFECTS_NOT_INSTALLED;
  if (effects === undefined) return NO_EFFECTS;
  return [
    counted(effects.particles, "particle", "particles"),
    counted(effects.emitters, "emitter", "emitters"),
    counted(effects.filters, "filter", "filters")
  ].join(" · ");
}

/**
 * The scene tile: entities, display objects and pooled, and the effects line. While the scene is
 * not there yet, the line shows only when the game has no effects plugin.
 *
 * @param scene - The tile data.
 * @param installed - False when the game has no effects plugin.
 * @returns The view.
 * @example
 * ```ts
 * sceneView({ entities: 101, views: 180, pooled: 24, effects: { particles: 18, emitters: 1, filters: 24, renderPasses: 49 } }, true).note;
 * // "18 particles · 1 emitter · 24 filters"
 * ```
 */
function sceneView(scene: MetricTiles["scene"], installed: boolean): TileView {
  if (scene === undefined) {
    const view = waiting("scene", "Scene", "Waiting for the scene");
    return installed ? view : { ...view, note: EFFECTS_NOT_INSTALLED };
  }
  const { entities, views, pooled, effects } = scene;
  const sub = `${views} display objects · ${pooled} pooled`;
  return {
    ...shown("scene", "Scene", String(entities), "entities", sub),
    note: effectsLine(effects, installed)
  };
}

/**
 * The texture memory tile, with the unused warn line.
 *
 * @param textures - The tile data.
 * @returns The view.
 * @example
 * ```ts
 * texturesView({ gpuMb: 41.25, count: 12, bundles: 2, budgetMb: 192, unused: 3, unusedMb: 5.73 }).warn; // "3 unused · 5.73 MB"
 * ```
 */
function texturesView(textures: MetricTiles["textures"]): TileView {
  const label = "Texture memory";
  if (textures === undefined) {
    return waiting("textures", label, "Waiting for game.render and game.assets");
  }
  const { gpuMb, count, bundles, budgetMb, unused, unusedMb } = textures;
  const sub = `${count} textures · ${bundles} bundles · of ${budgetMb} MB budget`;
  return {
    ...shown("textures", label, fixed(gpuMb), "MB GPU", sub),
    warn: unused > 0 ? `${unused} unused · ${fixed(unusedMb)} MB` : undefined
  };
}

/**
 * The FPS tile: the current fps, and the rest note while the newest sample sits at the game's
 * idle rate (28-32 fps, D-28), else the sample count and the low.
 *
 * @param fps - The tile data.
 * @returns The view.
 * @example
 * ```ts
 * fpsView({ now: 59.6, samples: [58, 60, 59.6], low: 58 }).sub; // "last 3 samples · low 58"
 * fpsView({ now: 30, samples: [60, 30], low: 30 }).sub; // "Resting at 30 fps: nothing moved for 2 s (game time.idleFps)"
 * ```
 */
function fpsView(fps: MetricTiles["fps"]): TileView {
  if (fps === undefined) return waiting("fps", "FPS", "Waiting for game.render");
  const { now, samples, low } = fps;
  const resting = now >= IDLE_FPS.min && now <= IDLE_FPS.max;
  const sub = resting
    ? RESTING
    : `last ${counted(samples.length, "sample", "samples")} · low ${Math.round(low)}`;
  return shown("fps", "FPS", String(Math.round(now)), "fps", sub);
}

/**
 * The JS heap tile, only while the page reports its heap (Chromium).
 *
 * @param heap - The tile data.
 * @returns The view, or none when the heap is absent.
 * @example
 * ```ts
 * heapViews({ kind: "value", usedMb: 12.8, limitMb: 4095.8 })[0]?.sub; // "of 4095.8 MB"
 * heapViews({ kind: "absent" }); // []
 * ```
 */
function heapViews(heap: MetricTiles["heap"]): readonly TileView[] {
  if (heap.kind === "absent") return [];
  return [shown("heap", "JS heap", short(heap.usedMb), "MB", `of ${short(heap.limitMb)} MB`)];
}

/**
 * The texts of the tiles, in display order. The JS heap tile is left out while the page does
 * not report its heap.
 *
 * @param tiles - The derived tiles.
 * @returns FPS, frame time, draw calls, texture memory, scene and, when reported, JS heap.
 * @example
 * ```ts
 * tileViews(snapshot.tiles)[0]?.sub; // "last 3 samples · low 58"
 * tileViews(snapshot.tiles).length; // 5 outside Chromium, 6 with the JS heap tile
 * ```
 */
export function tileViews(tiles: MetricTiles): readonly TileView[] {
  const { frameMs } = tiles;
  return [
    fpsView(tiles.fps),
    frameMs === undefined
      ? waiting("frame", "Frame time", "Waiting for game.render")
      : shown(
          "frame",
          "Frame time",
          short(frameMs),
          "ms",
          "Phase split not reported by game.render"
        ),
    drawsView(tiles.drawCalls),
    texturesView(tiles.textures),
    sceneView(tiles.scene, tiles.effectsInstalled !== false),
    ...heapViews(tiles.heap)
  ];
}

/**
 * The points of the FPS sparkline: samples spread over the width, the lowest at the bottom; one
 * sample draws a flat line in the middle.
 *
 * @param samples - The FPS samples.
 * @param width - Box width.
 * @param height - Box height.
 * @returns The SVG `points` text, "" without samples.
 * @example
 * ```ts
 * sparkPoints([0, 60], 100, 20); // "0,20 100,0"
 * ```
 */
export function sparkPoints(samples: readonly number[], width: number, height: number): string {
  if (samples.length === 0) return "";

  const values = samples.length === 1 ? [samples[0] ?? 0, samples[0] ?? 0] : samples;
  const low = Math.min(...values);
  const span = Math.max(...values) - low;
  const step = width / (values.length - 1);
  return values
    .map((value, index) => {
      const y = span === 0 ? height / 2 : height - ((value - low) / span) * height;
      return `${short(index * step)},${short(y)}`;
    })
    .join(" ");
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
