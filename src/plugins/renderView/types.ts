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
  /** Where the game's asset manifest may live, tried in order through link.files.read. */
  manifestPaths: readonly string[];
};

/**
 * game.render as renderView reads it (mirrors the game's RenderStats).
 *
 * @example
 * ```ts
 * const stats: RenderStats = { fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25, views: 180, pooled: 24 };
 * ```
 */
export type RenderStats = {
  fps: number;
  frameMs: number;
  textures: number;
  textureMb: number;
  views: number;
  pooled: number;
  /** Absent under WebGPU: the game counts no draw calls there. */
  drawCalls?: number;
};

/**
 * game.assets as renderView reads it (mirrors the game's Usage).
 *
 * @example
 * ```ts
 * const usage: AssetsUsage = { textureMb: 3.5, budgetMb: 192, bundles: [{ name: "board", tier: "scene", mb: 3.5, lastUsed: 12 }] };
 * ```
 */
export type AssetsUsage = {
  textureMb: number;
  budgetMb: number;
  bundles: readonly { name: string; tier: string; mb: number; lastUsed: number }[];
};

/**
 * One release-log entry: a bundle that left game.assets, at the frame of the last game.render.
 *
 * @example
 * ```ts
 * const entry: ReleaseEntry = { frame: 1841, bundle: "home", tier: "scene", mb: 2.5 };
 * ```
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
  /** The Render workspace is shown. */
  active: boolean;
  /** The link session the session data belongs to (a change clears it). */
  session: string | undefined;
  /** Frame of the last game.render value. */
  lastFrame: number | undefined;
  /** First frame seen in this session. */
  firstFrame: number | undefined;
  render: RenderStats | undefined;
  assets: AssetsUsage | undefined;
  /** Last scene values (while Render is shown). */
  sources: { ui?: Json; entities?: Json; projections?: Json };
  scene: SceneSnapshot | undefined;
  calibration: Calibration | undefined;
  /** The game.rect calibration was asked in this session and for this device. */
  calibrationAsked: boolean;
  /** undefined = not asked, null = no manifest. */
  catalogue: TextureCatalogue | null | undefined;
  /** Last `fpsSamples` fps values. */
  fps: number[];
  /** Bundles of the previous game.assets value. */
  loaded: Map<string, { tier: string; mb: number }>;
  /** Newest first, at most releaseLogMax. */
  releases: ReleaseEntry[];
  /** Texture key → the frames of its use. */
  seen: Map<string, { lastSeen: number; unusedSince: number | undefined }>;
  /** Scene node ids. */
  tree: { open: Set<string>; selected: string | undefined };
  /** Bundle "all" = no filter. */
  table: { sort: TextureSortKey; dir: 1 | -1; bundle: string; hover: string | undefined };
  /** A reveal that waits for the first scene. */
  pendingReveal: ElementRef | undefined;
  /** Element ringed over the game frame. */
  box: ElementRef | undefined;
  /** renderView's child of workspace.gameFrame().overlay(). */
  overlayRoot: HTMLElement | undefined;
  /** Last shape error. */
  error: string | undefined;
  /** Removes the Textures palette items of the current catalogue. */
  palette: (() => void) | undefined;
  /** Unwatch of game.render and game.assets, and the device listener. */
  tracker: (() => void)[];
  /** Unwatch of the scene sources; empty while Render is hidden. */
  watching: (() => void)[];
  /** UI subscribers. */
  listeners: Set<() => void>;
};

/**
 * Derived use of one texture.
 *
 * @example
 * ```ts
 * const use: TextureUse = { kind: "unused-since", frame: 212 };
 * ```
 */
export type TextureUse =
  | { kind: "in-use" }
  | { kind: "unused-since"; frame: number }
  | { kind: "not-seen"; since: number };

/**
 * One row of the textures table.
 *
 * @example
 * ```ts
 * const row: TextureRow = { key: "board.cell", bundle: "board", width: 224, height: 219, gpuMb: 0.19, fileMb: 0.187, use: { kind: "in-use" } };
 * ```
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
 *
 * @example
 * ```ts
 * const row: BundleRow = { name: "board", tier: "scene", mb: 3.5, files: 12, fileMb: 10.226, share: 1 };
 * ```
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
 *
 * @example
 * ```ts
 * const row: TreeRow = { id: "ui:boardScreen/boardSlot", depth: 1, name: "boardSlot", type: "stack", open: false, hasChildren: true, texture: "board.board-tray", entity: undefined, key: "boardSlot" };
 * ```
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
 * The derived view data (copies, never the live maps).
 */
export type RenderSnapshot = {
  frame: number | undefined;
  tiles: MetricTiles;
  tree: readonly TreeRow[];
  /** The rows of the table: loaded bundles, the bundle filter applied, sorted. */
  textures: readonly TextureRow[];
  bundles: readonly BundleRow[];
  pools: { views: number; pooled: number } | undefined;
  releases: readonly ReleaseEntry[];
};

/**
 * The renderView api (`app.renderView`, `ctx.require(renderViewPlugin)`).
 *
 * @example
 * ```ts
 * app.workspace.show("render");
 * app.renderView.snapshot().tiles.heap; // { kind: "absent" }
 * ```
 */
export type RenderViewApi = {
  /**
   * Re-reads the asset manifest and the game.rect calibration (the Textures card's Refresh and a
   * device change). Live values come from the watches: this is not a poll. Does nothing while the
   * link is not live or paused.
   *
   * @returns Resolves when both reads settled (never rejects).
   * @example
   * ```ts
   * // The game's manifest.json changed on disk: read it again.
   * await app.renderView.refresh();
   * app.renderView.snapshot().textures.length; // 3: the textures of the loaded bundles
   * ```
   */
  refresh(): Promise<void>;

  /**
   * The derived view data: tiles, visible tree rows, texture rows (filter and sort applied),
   * bundles, pools and the release log. Copies, never the live maps (spec/11 §2.4).
   *
   * @returns The snapshot.
   * @example
   * ```ts
   * // An MCP tool reports the render numbers of the connected game.
   * const { tiles } = app.renderView.snapshot();
   * tiles.drawCalls; // { kind: "absent" } on WebGPU
   * tiles.fps; // { now: 0, samples: [0], low: 0 } on the inert renderer
   * ```
   */
  snapshot(): RenderSnapshot;

  /**
   * Shows Render, opens every ancestor row of the element, selects it and scrolls it into view.
   * Before the first scene (Render was hidden) the ref waits and applies on the first scene.
   * The `workspace:reveal` hook calls it.
   *
   * @param ref - The element.
   * @example
   * ```ts
   * // gameView's Element tab "Show in render tree" emits workspace:reveal; the hook does:
   * app.renderView.reveal({ kind: "entity", id: 3_145_728 });
   * app.renderView.snapshot().tree.find(row => row.id === "entity:3145728")?.depth; // 2
   * ```
   */
  reveal(ref: ElementRef): void;

  /**
   * Draws the pink box (`--pick-tree`) around the element in renderView's root inside
   * `workspace.gameFrame().overlay()` (device space), from the calibrated scene rect. `undefined`
   * clears it; a ref without a rect draws nothing.
   *
   * @param ref - The element, or undefined to clear.
   * @example
   * ```ts
   * // A tree row is hovered: ring the board slot over the game preview, then clear on leave.
   * app.renderView.highlight({ kind: "ui", path: "boardScreen/boardSlot" });
   * app.renderView.highlight(undefined);
   * ```
   */
  highlight(ref: ElementRef | undefined): void;

  /**
   * Sorts the textures table. The same key flips the direction; a new key sorts numbers
   * descending and text ascending.
   *
   * @param key - The column.
   * @example
   * ```ts
   * // The Texture column header was clicked.
   * app.renderView.sortTextures("key");
   * app.renderView.snapshot().textures.map(row => row.key); // ["board.board-tray", "board.cell", ...]
   * ```
   */
  sortTextures(key: TextureSortKey): void;

  /**
   * Filters the textures table by bundle: `"all"` or a bundle name (the bundle chips).
   *
   * @param bundle - "all" or a bundle name.
   * @example
   * ```ts
   * // The "ui" chip was picked.
   * app.renderView.filterBundle("ui");
   * app.renderView.snapshot().textures.every(row => row.bundle === "ui"); // true
   * ```
   */
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
