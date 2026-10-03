/**
 * @file renderView plugin — the pure texts of the Render workspace: the six tiles, the sparkline
 * points, the texture use tags and the bounds line. What the game does not report is named.
 */
import type { PageRect } from "../panels/shared/scene";
import type { MetricTiles, TextureUse } from "./types";

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
 * drawsView({ kind: "value", value: 14, renderPasses: 1 }).sub; // "1 render passes"
 * ```
 */
function drawsView(draws: MetricTiles["drawCalls"]): TileView {
  const label = "Draw calls";
  if (draws === undefined) return waiting("draws", label, "Waiting for game.render");
  const passes =
    draws.renderPasses === undefined ? undefined : `${draws.renderPasses} render passes`;
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
 * The scene tile: entities, display objects and pooled, and the effects line (game 0.0.3) or
 * what the game does not report.
 *
 * @param scene - The tile data.
 * @returns The view.
 * @example
 * ```ts
 * sceneView({ entities: 101, views: 180, pooled: 24, effects: { particles: 18, emitters: 1, filters: 24, renderPasses: 49 } }).note;
 * // "18 particles · 1 emitters · 24 filters"
 * ```
 */
function sceneView(scene: MetricTiles["scene"]): TileView {
  if (scene === undefined) return waiting("scene", "Scene", "Waiting for the scene");
  const { entities, views, pooled, effects } = scene;
  const sub = `${views} display objects · ${pooled} pooled`;
  return {
    ...shown("scene", "Scene", String(entities), "entities", sub),
    note:
      effects === undefined
        ? NO_EFFECTS
        : `${effects.particles} particles · ${effects.emitters} emitters · ${effects.filters} filters`
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
 * The texts of the six tiles, in display order.
 *
 * @param tiles - The derived tiles.
 * @returns FPS, frame time, draw calls, texture memory, scene, JS heap.
 * @example
 * ```ts
 * tileViews(snapshot.tiles)[0]?.sub; // "last 3 samples · low 58"
 * ```
 */
export function tileViews(tiles: MetricTiles): readonly TileView[] {
  const { fps, frameMs } = tiles;
  return [
    fps === undefined
      ? waiting("fps", "FPS", "Waiting for game.render")
      : shown(
          "fps",
          "FPS",
          String(Math.round(fps.now)),
          "fps",
          `last ${fps.samples.length} samples · low ${Math.round(fps.low)}`
        ),
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
    sceneView(tiles.scene),
    {
      ...shown("heap", "JS heap", "Not reported", "", "Needs heap numbers in game.render"),
      absent: true,
      aria: "JS heap: not reported"
    }
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
