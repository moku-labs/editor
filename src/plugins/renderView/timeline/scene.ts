/**
 * @file renderView timeline — what a paint needs beside Mission control's state (spec 09 § M8, M11):
 * the view's end and span, the live end, the palette, which sections draw, the source-switch marker
 * placed on the source clock, and the caches every painter shares (labels, flag boxes, the lane's
 * colours). One object per mounted instrument, changed in place by the loop every frame: a paint
 * allocates none.
 */
import type { SourceMarker } from "../source/contract";
import type { FlagHits } from "./hit";
import { createFlagHits } from "./hit";
import type { LabelCache } from "./labels";
import { createLabelCache } from "./labels";
import type { MissionPalette } from "./palette";

/**
 * The inputs of one paint, reused frame after frame.
 *
 * @example
 * ```ts
 * const scene: PaintScene = createPaintScene(readPalette(root));
 * scene.endMs = liveEnd(mission.clock, now, reduced) ?? 0;
 * paintFrames(g, layout, mission, scene);
 * ```
 */
export type PaintScene = {
  /** The view's right edge, source clock. */
  endMs: number;
  /** The view's span, ms. */
  span: number;
  /** The live right edge (the overview ends there; equal to `endMs` while live). */
  liveEndMs: number;
  /** The view follows the clock: the axis reads "now", else "view end". */
  live: boolean;
  palette: MissionPalette;
  /** GC marks: drawn, the Memory & GC section is off, or not measured on this device. */
  gc: "on" | "off" | "none";
  /** GPU time is on and measured: bars stack it. */
  gpu: boolean;
  /** The Shaders & passes section is on: the lane draws passes. */
  passes: boolean;
  /** The newest source switch on the source clock; NaN for none. */
  markerT: number;
  /** Its label before " · " ("Galaxy A26 disconnected here"). */
  markerLeft: string;
  /** Its label after " · " ("Local preview resumed"). */
  markerRight: string;
  /** The overview's words left of the marker ("before: Galaxy A26"); empty for none. */
  markerBefore: string;
  readonly labels: LabelCache;
  readonly hits: FlagHits;
  /** The lane's colour index of each pass view, by first appearance ("main" first). */
  readonly laneColours: Map<string, number>;
};

/**
 * Makes a scene: nothing drawn yet, every section on, no marker.
 *
 * @param palette - The colours.
 * @returns The scene.
 * @example
 * ```ts
 * createPaintScene(palette).span; // 6000
 * ```
 */
export function createPaintScene(palette: MissionPalette): PaintScene {
  return {
    endMs: 0,
    span: 6000,
    liveEndMs: 0,
    live: true,
    palette,
    gc: "on",
    gpu: true,
    passes: true,
    markerT: Number.NaN,
    markerLeft: "",
    markerRight: "",
    markerBefore: "",
    labels: createLabelCache(),
    hits: createFlagHits(),
    laneColours: new Map()
  };
}

/**
 * The source-clock time of a source switch: the marker's computer time mapped with the clock offset
 * and the page's time origin (`at + offset − timeOrigin`); without them, the first row of the new
 * source.
 *
 * @param marker - activeSource's newest marker.
 * @param offsetMs - activeSource.clockOffsetMs(); null before two heartbeats.
 * @param timeOrigin - The page's clock origin (the second's epoch); null before it is known.
 * @param firstT - The history's first row time; undefined without rows.
 * @returns Source-clock ms; NaN when it cannot be placed.
 * @example
 * ```ts
 * markerTime(marker, 0, 1_792_000_000_000, 10_000); // 93 963: the local preview's own clock
 * ```
 */
export function markerTime(
  marker: SourceMarker,
  offsetMs: number | null,
  timeOrigin: number | null,
  firstT: number | undefined
): number {
  if (offsetMs !== null && timeOrigin !== null) return marker.at + offsetMs - timeOrigin;
  return firstT ?? Number.NaN;
}

/**
 * Sets the scene's marker (when the newest marker or its placement changed, not per paint).
 *
 * @param scene - The scene.
 * @param marker - The marker; undefined for none.
 * @param t - Its source-clock time (`markerTime`).
 * @param before - The source before it, for the overview ("Galaxy A26"); undefined for none.
 * @example
 * ```ts
 * setMarker(scene, marker, markerTime(marker, offset, origin, history.t[0]), "Galaxy A26");
 * scene.markerRight; // "Local preview resumed"
 * ```
 */
export function setMarker(
  scene: PaintScene,
  marker: SourceMarker | undefined,
  t: number,
  before: string | undefined
): void {
  if (marker === undefined) {
    scene.markerT = Number.NaN;
    return;
  }
  const cut = marker.label.indexOf(" · ");
  scene.markerT = t;
  scene.markerLeft = cut === -1 ? marker.label : marker.label.slice(0, cut);
  scene.markerRight = cut === -1 ? "" : marker.label.slice(cut + 3);
  scene.markerBefore = before === undefined ? "" : `before: ${before}`;
}

/** The lane's colours in order of first appearance ("main" takes the first). */
export const LANE_COLOURS = [
  "phase1",
  "pickPink",
  "phase2",
  "edge",
  "phase3",
  "teal",
  "pickBlue"
] as const;

/**
 * The colour of a pass view in the lane and its legend: "main" phase-1, the others by first
 * appearance, cycling.
 *
 * @param scene - The scene (its colour table).
 * @param view - The pass's view name; "" for an unnamed pass.
 * @returns The palette colour.
 * @example
 * ```ts
 * laneColourOf(scene, "fogLayer"); // palette.pickPink: the first view after main
 * ```
 */
export function laneColourOf(scene: PaintScene, view: string): string {
  const { laneColours } = scene;
  const known = laneColours.get(view);
  if (known !== undefined) return scene.palette[LANE_COLOURS[known] ?? "phase1"];
  const others = laneColours.size - (laneColours.has("main") ? 1 : 0);
  const index = view === "main" ? 0 : (others + 1) % LANE_COLOURS.length;
  laneColours.set(view, index);
  return scene.palette[LANE_COLOURS[index] ?? "phase1"];
}
