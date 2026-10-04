/**
 * @file Shared view module — scene types (R8): page rects, element refs, scene nodes and
 * snapshots, calibration, texture catalogue. `ElementRef` is the payload type of the global tools
 * events `workspace:reveal` and `workspace:inspect` (src/config.ts imports it from here).
 */
import type { Json } from "../../../registry/protocol";

/**
 * A rect in CSS px of the game page (the iframe viewport = device W×H).
 */
export type PageRect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/**
 * A ui element by its path of segments, or a world entity by id.
 *
 * @example
 * ```ts
 * const ref: ElementRef = { kind: "ui", path: "column#0/hudRow/coins" };
 * ```
 */
export type ElementRef =
  | { readonly kind: "ui"; readonly path: string }
  | { readonly kind: "entity"; readonly id: number };

/**
 * One node of the scene.
 */
export type SceneNode = {
  /** refId(ref): "ui:<path>" | "entity:<id>". */
  readonly id: string;
  readonly ref: ElementRef;
  readonly name: string;
  readonly type: string;
  readonly parent: string | undefined;
  readonly children: readonly string[];
  /** undefined: could not be placed. */
  readonly rect: PageRect | undefined;
  /**
   * The same rect in reference units (root units of the game's layout), before the calibration
   * maps it to page px; equal to `rect` in a scene without a calibration. undefined: not placed.
   */
  readonly refRect: PageRect | undefined;
  readonly texture: string | undefined;
  readonly key: string | undefined;
  readonly style: Readonly<Record<string, Json>> | undefined;
  /** false: the node draws nothing (alpha 0 or `visible: false`); the picker looks through it. */
  readonly visible: boolean;
  readonly entity:
    | { readonly id: number; readonly owner: string; readonly components: readonly string[] }
    | undefined;
};

/**
 * One built scene.
 */
export type SceneSnapshot = {
  readonly frame: number;
  /** false: rects are reference units (no calibration given). */
  readonly calibrated: boolean;
  readonly nodes: ReadonlyMap<string, SceneNode>;
  readonly roots: readonly string[];
  /** Back to front, for hit tests. */
  readonly paintOrder: readonly string[];
  /** Every texture key in use this frame. */
  readonly referencedTextures: ReadonlySet<string>;
  /** All entities of game.entities. */
  readonly entityCount: number;
};

/**
 * Reference units → page CSS px.
 */
export type Calibration = { readonly scale: number; readonly x: number; readonly y: number };

/**
 * The input of buildScene.
 */
export type SceneInput = {
  readonly ui: Json;
  readonly entities: Json;
  readonly projections: Json;
  readonly frame: number;
  readonly calibration: Calibration | undefined;
};

/**
 * A value of the wrong shape (returned, never thrown).
 */
export type SceneError = {
  readonly error: "shape";
  readonly source: "game.ui" | "game.entities" | "game.projections";
  readonly path: string;
};

/**
 * One texture of the game's asset manifest.
 */
export type TextureInfo = {
  readonly key: string;
  readonly bundle: string;
  readonly width: number;
  readonly height: number;
  readonly gpuMb: number;
  readonly fileMb: number;
};

/**
 * The parsed asset manifest.
 */
export type TextureCatalogue = {
  /** Where the manifest was found. */
  readonly path: string;
  readonly textures: ReadonlyMap<string, TextureInfo>;
  readonly bundles: ReadonlyMap<
    string,
    { readonly tier: string; readonly files: number; readonly fileMb: number }
  >;
};

/**
 * What the frame transforms need of workspace's gameFrame().box().
 */
export type FrameBoxLike = { readonly left: number; readonly top: number; readonly scale: number };
