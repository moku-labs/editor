/**
 * @file renderView plugin — type definitions: config, state, the game.render / game.assets shapes,
 * derived rows and tiles, the snapshot, the api, the domain context and the hooks. Scene types
 * come from panels/shared/scene (R8), never from gameView (R4).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type {
  Calibration,
  ElementRef,
  SceneSnapshot,
  TextureCatalogue
} from "../panels/shared/scene";
import type { Json } from "../registry/protocol";

/**
 * renderView configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { renderView: { fpsSamples: 120 } } });
 * ```
 */
export type RenderViewConfig = {
  /** FPS samples kept for the sparkline (one per changed game.render value). */
  fpsSamples: number;
  /** Release log entries kept, newest first. */
  releaseLogMax: number;
  /** Where the game's asset manifest may live, tried in order. */
  manifestPaths: readonly string[];
};

/**
 * game.render as renderView reads it.
 */
export type RenderStats = {
  fps: number;
  frameMs: number;
  textures: number;
  textureMb: number;
  views: number;
  pooled: number;
  drawCalls?: number;
};

/**
 * game.assets as renderView reads it.
 */
export type AssetsUsage = {
  textureMb: number;
  budgetMb: number;
  bundles: readonly { name: string; tier: string; mb: number; lastUsed: number }[];
};

/**
 * One release-log entry (a bundle that left game.assets).
 */
export type ReleaseEntry = {
  readonly frame: number;
  readonly bundle: string;
  readonly tier: string;
  readonly mb: number;
};

/**
 * Sort key of the textures table.
 */
export type TextureSortKey = "key" | "bundle" | "size" | "gpuMb" | "fileMb" | "use";

/**
 * renderView state.
 */
export type RenderViewState = {
  active: boolean;
  lastFrame: number | undefined;
  firstFrame: number | undefined;
  render: RenderStats | undefined;
  assets: AssetsUsage | undefined;
  sources: { ui?: Json; entities?: Json; projections?: Json };
  scene: SceneSnapshot | undefined;
  calibration: Calibration | undefined;
  /** undefined = not asked, null = no manifest. */
  catalogue: TextureCatalogue | null | undefined;
  fps: number[];
  loaded: Map<string, { tier: string; mb: number }>;
  releases: ReleaseEntry[];
  seen: Map<string, { lastSeen: number; unusedSince: number | undefined }>;
  tree: { open: Set<string>; selected: string | undefined };
  table: { sort: TextureSortKey; dir: 1 | -1; bundle: string; hover: string | undefined };
  pendingReveal: ElementRef | undefined;
  box: ElementRef | undefined;
  overlayRoot: HTMLElement | undefined;
  error: string | undefined;
  tracker: (() => void)[];
  watching: (() => void)[];
  listeners: Set<() => void>;
};

/**
 * Derived use of one texture.
 */
export type TextureUse =
  | { kind: "in-use" }
  | { kind: "unused-since"; frame: number }
  | { kind: "not-seen"; since: number };

/**
 * One row of the textures table.
 */
export type TextureRow = {
  key: string;
  bundle: string;
  width: number;
  height: number;
  gpuMb: number;
  fileMb: number;
  use: TextureUse;
};

/**
 * One row of the bundles card.
 */
export type BundleRow = {
  name: string;
  tier: string;
  mb: number;
  files: number | undefined;
  fileMb: number | undefined;
  share: number;
};

/**
 * One visible row of the render tree.
 */
export type TreeRow = {
  id: string;
  depth: number;
  name: string;
  type: string;
  open: boolean;
  hasChildren: boolean;
  texture: string | undefined;
  entity: number | undefined;
  key: string | undefined;
};

/**
 * The six metric tiles.
 */
export type MetricTiles = {
  fps: { now: number; samples: readonly number[]; low: number } | undefined;
  frameMs: number | undefined;
  drawCalls: { kind: "value"; value: number } | { kind: "absent" } | undefined;
  textures:
    | {
        gpuMb: number;
        count: number;
        bundles: number;
        budgetMb: number;
        unused: number;
        unusedMb: number;
      }
    | undefined;
  scene: { entities: number; views: number; pooled: number } | undefined;
  /** Not reported by the game (follow-up F-R1). */
  heap: { kind: "absent" };
};

/**
 * The derived view data (copies).
 */
export type RenderSnapshot = {
  frame: number | undefined;
  tiles: MetricTiles;
  tree: readonly TreeRow[];
  textures: readonly TextureRow[];
  bundles: readonly BundleRow[];
  pools: { views: number; pooled: number } | undefined;
  releases: readonly ReleaseEntry[];
};

/**
 * The renderView api (`app.renderView`).
 *
 * @example
 * ```ts
 * app.renderView.snapshot().tiles.drawCalls; // { kind: "absent" }
 * ```
 */
export type RenderViewApi = {
  /** Re-reads the asset manifest and the calibration (not a poll). */
  refresh(): Promise<void>;
  snapshot(): RenderSnapshot;
  /** Shows Render, opens the ancestors, selects the row (the workspace:reveal hook calls it). */
  reveal(ref: ElementRef): void;
  /** Pink box in renderView's root inside gameFrame().overlay(); undefined clears it. */
  highlight(ref: ElementRef | undefined): void;
  sortTextures(key: TextureSortKey): void;
  filterBundle(bundle: string): void;
};

/**
 * Domain context of renderView: the kernel context is assignable to it.
 */
export type RenderViewCtx = {
  readonly config: Readonly<RenderViewConfig>;
  state: RenderViewState;
  readonly emit: EmitFn<Pick<ToolsEvents, "workspace:inspect">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * renderView's hooks (global tools events, R4).
 */
export type RenderViewHooks = {
  readonly "workspace:changed": (payload: ToolsEvents["workspace:changed"]) => void;
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
  readonly "workspace:reveal": (payload: ToolsEvents["workspace:reveal"]) => void;
};
