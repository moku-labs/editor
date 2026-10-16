/**
 * @file renderView plugin — type definitions: config, state (the scene cards' fields and Mission
 * control's `mission`), the game.render / game.assets / game.effects shapes, derived rows and the
 * scene tiles, the snapshot, Mission control's views and answers, the api, the domain context and the
 * hooks. Scene types come from panels/shared/scene (R8), never from gameView (R4). The values of the
 * other units (perf/protocol, recorder/protocol, activeSource, connect/protocol) arrive through the
 * one door `source/contract.ts`; the side series and the view clock live in `series/types.ts` and
 * `view/types.ts` (spec 09 § M12).
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
import type { MissionSeries } from "./series/types";
import type {
  ActiveSource,
  ConnectRequest,
  DeviceTelemetry,
  LogMark,
  PerfCause,
  PerfDetailWire,
  PerfHistory,
  PerfPassesWire,
  PerfSecond,
  RecorderSource,
  RecordOrigin,
  SourceChange
} from "./source/contract";
import type { DisplayClock, FrameRange, MissionSpan, MissionViewState } from "./view/types";

export type { FrameRange, MissionSpan } from "./view/types";

/**
 * renderView configuration. No Mission control option: the history's size is perf's HISTORY_MS /
 * HISTORY_ROWS, a rule of the data (spec 09 § M12).
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { renderView: { releaseLogMax: 100 } } });
 * ```
 */
export type RenderViewConfig = {
  /** Release log entries kept, newest first. */
  releaseLogMax: number;
};

/**
 * game.render as renderView reads it (mirrors the game's RenderStats).
 *
 * @example
 * ```ts
 * const stats: RenderStats = { fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25, views: 180, pooled: 24, renderPasses: 1, drawCalls: 14 };
 * ```
 */
export type RenderStats = {
  fps: number;
  frameMs: number;
  textures: number;
  textureMb: number;
  views: number;
  pooled: number;
  /** Render passes of the frame (game 0.0.3); absent on an older game. */
  renderPasses?: number;
  /** A dev-build counter on any backend: absent in a production build. */
  drawCalls?: number;
};

/**
 * game.effects as renderView reads it (mirrors the game's EffectsStats, game 0.0.3).
 *
 * @example
 * ```ts
 * const effects: EffectsStats = { particles: 18, emitters: 1, filters: 24, renderPasses: 49 };
 * ```
 */
export type EffectsStats = {
  /** Live particles over every instance and orphan. */
  particles: number;
  /** Running emitter instances plus the orphans still flying. */
  emitters: number;
  /** Filter instances over every view. */
  filters: number;
  /** Render passes of the frame. */
  renderPasses: number;
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
 * A frame rate the rate switch asks for: pinned 60 or 120, or the adaptive rule.
 *
 * @example
 * ```ts
 * const choice: RateChoice = "adaptive";
 * ```
 */
export type RateChoice = 60 | 120 | "adaptive";

/**
 * A row of the Monitoring popover (spec 09 § M7): `nodes` is the "Nodes" sub-row and runs
 * `editor.perf.sections { nodes }`; `passes` covers the engine's passes and shaders sections.
 *
 * @example
 * ```ts
 * const row: MonitorSection = "nodes";
 * ```
 */
export type MonitorSection =
  | "frames"
  | "gpu"
  | "memory"
  | "render"
  | "systems"
  | "nodes"
  | "passes";

/**
 * What a rate switch answered: the new rate and mode, or a refusal, held pin or failure in words.
 *
 * @example
 * ```ts
 * const pinned: RateAnswer = { ok: true, choice: 120, text: "Pinned at 120, adaptive off", fps: 120, mode: "fixed" };
 * const held: RateAnswer = { ok: false, choice: 120, text: "Refused: this display runs at 60 Hz" };
 * ```
 */
export type RateAnswer =
  | {
      readonly ok: true;
      readonly choice: RateChoice;
      readonly text: string;
      readonly fps: number;
      readonly mode: "fixed" | "auto" | "forced";
    }
  | { readonly ok: false; readonly choice: RateChoice; readonly text: string };

/**
 * What a Monitoring switch answered: ok or a refusal in words, and every row's state after it.
 *
 * @example
 * ```ts
 * const answer: SectionsAnswer = { ok: false, text: "Frames are always measured", sections: undefined };
 * ```
 */
export type SectionsAnswer = {
  readonly ok: boolean;
  readonly text: string;
  readonly sections: Readonly<Record<MonitorSection, "on" | "off" | "unavailable">> | undefined;
};

/**
 * What Record or Stop answered: ok or a refusal in words, and the log's file name.
 *
 * @example
 * ```ts
 * const answer: RecordAnswer = { ok: true, text: "Recording on Galaxy A26", file: "perf-20261016-1102-sm-a266b.jsonl" };
 * ```
 */
export type RecordAnswer = {
  readonly ok: boolean;
  readonly text: string;
  readonly file: string | null;
};

/**
 * The detail read of the current selection (`editor.perf.detail`, spec 03 D8): idle, loading,
 * shown (with why the rows are partial and the nodes the engine named) or failed.
 *
 * @example
 * ```ts
 * const shown: MissionDetail = { kind: "shown", range: { from: 4810, to: 4860 }, reason: "no-detail", nodes: null };
 * ```
 */
export type MissionDetail =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly range: FrameRange }
  | {
      readonly kind: "shown";
      readonly range: FrameRange;
      readonly reason: PerfDetailWire["reason"];
      readonly nodes: PerfDetailWire["nodes"];
    }
  | { readonly kind: "failed"; readonly range: FrameRange; readonly message: string };

/**
 * Mission control's data and UI state (spec 09 § M12): the active source, its watches and the
 * poll, the 2-minute history and the side series, the last source values, the clock, the view and
 * the selection, the commands in flight, the open popover and the Connect panel.
 */
export type MissionState = {
  /** activeSource.current() at the last activeSource:changed (spec 11 § 4); the label is read live with label(). */
  source: ActiveSource | undefined;
  /** Unwatch of every § M2 watch of the active source; empty while Render is hidden. */
  watches: (() => void)[];
  /** The poll of editor.perf.frames / editor.perf.events (M2 rule 2): its timer, the read in flight, the next events seq. */
  poll: {
    timer: ReturnType<typeof setInterval> | undefined;
    inFlight: boolean;
    eventsAfter: number | undefined;
  };
  /** perf's 2-minute history (spec 03 D10), allocated once with createPerfHistory(). */
  readonly history: PerfHistory;
  /** renderView's own side series (M11), allocated once. */
  readonly series: MissionSeries;
  /** The last editor.perf.second of the source; undefined before the first. */
  second: PerfSecond | undefined;
  /** The last editor.perf.passes (null before the agent's first full second); undefined before a read. */
  passes: PerfPassesWire | null | undefined;
  /** The last editor.recorder; undefined when the agent has no recorder source. */
  recorder: RecorderSource | undefined;
  /** activeSource.telemetry() at the last record (wired devices only). */
  telemetry: DeviceTelemetry | undefined;
  /** The playout-delay clock of every live graph (M11). */
  readonly clock: DisplayClock;
  /** Live or paused, the view's end while paused (source clock), the span. */
  view: MissionViewState;
  /** The selected frames; undefined: none. */
  selection: FrameRange | undefined;
  /** Bumped on every selection change: painters and the inspector key on it. */
  selectionVersion: number;
  /** The detail read of the current selection (editor.perf.detail, spec 03 D8). */
  detail: MissionDetail;
  /** Source time under the pointer on any graph; undefined: no hover. Painters read it; it never notifies. */
  hoverMs: number | undefined;
  /** The rate switch: the choice in flight and the last answer. */
  rate: { pending: RateChoice | undefined; answer: RateAnswer | undefined };
  /** A Monitoring switch waiting for its answer. */
  sectionPending: MonitorSection | "overdraw" | undefined;
  /** The one open popover. */
  popover: "monitoring" | "record" | "connect" | "split" | "memory" | undefined;
  /** The Connect panel: tab, the scan lease's stop while open, the typed codes per pairing ticket, a pending row, an error. */
  connect: {
    tab: "wire" | "network";
    stopScan: (() => void) | undefined;
    codes: Map<string, string>;
    pending: string | undefined;
    error: { readonly key: string; readonly message: string } | undefined;
  };
  /** "Scene details" is open (collapsed by default; not persisted). */
  sceneOpen: boolean;
  /** project-index answers for system names (undefined: not asked; null: not found or an engine system). */
  readonly files: Map<string, { readonly path: string; readonly line: number } | null>;
  /** Stops the rAF loop of the mounted instrument; undefined while none runs. */
  stopLoop: (() => void) | undefined;
  /** Mission control's own UI subscribers (values re-render it, not the scene cards). */
  readonly listeners: Set<() => void>;
};

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
  /** Last good game.effects value; undefined = not reported or not yet delivered. */
  effects: EffectsStats | undefined;
  /** Unwatch of game.effects; set only while the manifest lists the source as available. */
  effectsWatch: (() => void) | undefined;
  /** False while the manifest lists game.effects with `available: false` (no effects plugin). */
  effectsInstalled: boolean;
  /** Last scene values (while Render is shown). */
  sources: { ui?: Json; entities?: Json; projections?: Json };
  scene: SceneSnapshot | undefined;
  calibration: Calibration | undefined;
  /** The calibration (game.locate or game.rect) was asked in this session and for this device. */
  calibrationAsked: boolean;
  /** undefined = not asked, null = no manifest. */
  catalogue: TextureCatalogue | null | undefined;
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
  /** Unwatch of game.render and game.assets, the manifest listener and the device listener. */
  tracker: (() => void)[];
  /** Unwatch of the scene sources; empty while Render is hidden. */
  watching: (() => void)[];
  /** UI subscribers of the scene cards. */
  listeners: Set<() => void>;
  /** Mission control (spec 09 § M12). */
  readonly mission: MissionState;
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
 * The scene numbers of the snapshot (the metric tiles' data without the FPS, frame-time and heap
 * tiles, which went with Mission control, spec 09 § M1).
 *
 * @example
 * ```ts
 * const tiles: MetricTiles = { drawCalls: { kind: "absent" }, textures: undefined, scene: { entities: 104, views: 180, pooled: 24 } };
 * ```
 */
export type MetricTiles = {
  /** The counter, or absent in a production build; renderPasses only when game.render reports it. */
  drawCalls:
    | (({ kind: "value"; value: number } | { kind: "absent" }) & { renderPasses?: number })
    | undefined;
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
  /** effects only when game.effects delivered (game 0.0.3). */
  scene: { entities: number; views: number; pooled: number; effects?: EffectsStats } | undefined;
  /**
   * Present, and false, only when the game has no effects plugin: the manifest lists game.effects
   * with `available: false`.
   */
  effectsInstalled?: false;
};

/**
 * The derived view data of the scene cards (copies, never the live maps).
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
 * What Mission control shows (copies): the source and its state, live or paused, the span and the
 * selection, the frames header numbers, the rate, the Monitoring rows, the overdraw view, memory and
 * the recording.
 *
 * @example
 * ```ts
 * const view: MissionView = app.renderView.mission()!;
 * view.source; // { session: "s-9", kind: "device", name: "Galaxy A26", link: "wire", state: "live" }
 * view.stats; // { frames: 720, spikes: 3, worstMs: 41.3, p90Ms: 17.6, restMs: 0, gcs: 2 }
 * ```
 */
export type MissionView = {
  readonly source: {
    readonly session: string | null;
    readonly kind: "local" | "device" | "page";
    readonly name: string;
    readonly link: "wire" | "network" | "local";
    readonly state: "live" | "waiting" | "not-started" | "no-monitor";
  };
  readonly live: boolean;
  /** ms the paused view is behind live; 0 live. */
  readonly behindMs: number;
  readonly span: MissionSpan;
  readonly selection: FrameRange | undefined;
  /** The frames header numbers of the view. */
  readonly stats: {
    readonly frames: number;
    readonly spikes: number;
    readonly worstMs: number | null;
    readonly p90Ms: number | null;
    readonly restMs: number;
    readonly gcs: number | null;
  };
  readonly rate: {
    readonly fps: number | null;
    readonly mode: "pinned" | "adaptive" | undefined;
    readonly why: string | undefined;
    readonly pending: RateChoice | undefined;
    readonly answer: RateAnswer | undefined;
  };
  readonly sections: Readonly<Record<MonitorSection, "on" | "off" | "unavailable">> | undefined;
  readonly overdraw: boolean | undefined;
  readonly memory: {
    readonly source: "cdp" | "performance.memory" | "shell" | "none";
    readonly heapMb: number | null;
    readonly processMb: { readonly app: number | null; readonly renderer: number | null } | null;
    readonly leak: boolean;
    readonly slopeMbPerMin: number | null;
  };
  readonly recording:
    | {
        readonly state: "idle" | "recording" | "exporting";
        readonly startedBy: RecordOrigin | null;
        readonly sinceMs: number;
        readonly bytes: number;
        readonly file: string | null;
        readonly marks: readonly LogMark[];
      }
    | undefined;
};

/**
 * One system of the inspector: total ms, its share of the range's JS work, its largest frame.
 *
 * @example
 * ```ts
 * const row: SystemRow = { name: "ward.update", totalMs: 312.4, share: 0.41, maxMs: 9.1 };
 * ```
 */
export type SystemRow = {
  readonly name: string;
  readonly totalMs: number;
  readonly share: number;
  readonly maxMs: number;
};

/**
 * A node the range updated or redrew, in words.
 *
 * @example
 * ```ts
 * const row: NodeRow = { label: "fogLayer", how: "redrawn", count: 51 };
 * ```
 */
export type NodeRow = {
  readonly label: string;
  readonly how: "updated" | "moved" | "loosened" | "invalidated" | "redrawn";
  readonly count: number;
};

/**
 * A file a system of the range lives in (the project index's `system:<name>`).
 *
 * @example
 * ```ts
 * const row: FileRow = { path: "src/systems/ward.ts", line: 12, system: "ward.update" };
 * ```
 */
export type FileRow = { readonly path: string; readonly line: number; readonly system: string };

/**
 * A pass of the range: how often, its GPU ms and its share (a tile GPU shows the share).
 *
 * @example
 * ```ts
 * const row: PassRow = { label: "fogLayer · filter", count: 102, gpuMs: 316.2, share: 0.58 };
 * ```
 */
export type PassRow = {
  readonly label: string;
  readonly count: number;
  readonly gpuMs: number | null;
  readonly share: number | null;
};

/**
 * A filter chain of the range.
 *
 * @example
 * ```ts
 * const row: FilterRow = { chain: "fog.blur → fog.blur", target: "fogLayer", count: 102, gpuMs: 316.2 };
 * ```
 */
export type FilterRow = {
  readonly chain: string;
  readonly target: string | null;
  readonly count: number;
  readonly gpuMs: number | null;
};

/**
 * A shader compile of the range.
 *
 * @example
 * ```ts
 * const row: CompileRow = { frame: 4851, label: "fog.blur", ms: 38.2, by: "fogLayer" };
 * ```
 */
export type CompileRow = {
  readonly frame: number;
  readonly label: string;
  readonly ms: number;
  readonly by: string | null;
};

/**
 * A rate change of the range, in words.
 *
 * @example
 * ```ts
 * const row: RateRow = { frame: 4855, from: 120, to: 60, why: "missed frames" };
 * ```
 */
export type RateRow = {
  readonly frame: number | null;
  readonly from: number;
  readonly to: number;
  readonly why: string;
};

/**
 * A spike group of the range: its frames, primary cause, label, worst ms and why.
 *
 * @example
 * ```ts
 * const row: SpikeRow = { from: 4851, to: 4853, cause: "compile", label: "Compile", maxMs: 41.3, why: "fog.blur compiled for 38.2 ms" };
 * ```
 */
export type SpikeRow = {
  readonly from: number;
  readonly to: number;
  readonly cause: PerfCause;
  readonly label: string;
  readonly maxMs: number;
  readonly why: string;
};

/**
 * A GC of the range.
 *
 * @example
 * ```ts
 * const row: GcRow = { frame: 4818, freedMb: 4.2, pauseMs: null };
 * ```
 */
export type GcRow = {
  readonly frame: number;
  readonly freedMb: number;
  readonly pauseMs: number | null;
};

/**
 * An object counter of the range and whether it grows.
 *
 * @example
 * ```ts
 * const row: ObjectRow = { name: "listeners", from: 212, to: 224, growing: true };
 * ```
 */
export type ObjectRow = {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly growing: boolean;
};

/**
 * The inspector (copies): the summary of the view, or the range view of a selection.
 *
 * @example
 * ```ts
 * app.renderView.inspect()?.kind; // "range" after a selection
 * ```
 */
export type InspectorView =
  | {
      readonly kind: "summary";
      readonly title: string;
      readonly frames: number;
      readonly systems: readonly SystemRow[];
      readonly passes: readonly PassRow[];
      readonly spikes: readonly SpikeRow[];
      readonly moreSpikes: number;
      readonly gcs: readonly GcRow[];
      readonly moreGcs: number;
      readonly rates: readonly RateRow[];
    }
  | {
      readonly kind: "range";
      readonly range: FrameRange;
      readonly frames: number;
      readonly durationMs: number;
      readonly worstMs: number;
      readonly detail: "full" | "top5" | "per-second" | "loading";
      readonly systems: readonly SystemRow[];
      readonly nodes: readonly NodeRow[];
      readonly files: readonly FileRow[];
      readonly passes: readonly PassRow[];
      readonly filters: readonly FilterRow[];
      readonly compiles: readonly CompileRow[];
      readonly rates: readonly RateRow[];
      readonly spikes: readonly SpikeRow[];
      readonly gcs: readonly GcRow[];
      readonly objects: readonly ObjectRow[];
    };

/**
 * The renderView api (`app.renderView`, `ctx.require(renderViewPlugin)`): the scene cards and
 * Mission control.
 *
 * @example
 * ```ts
 * app.workspace.show("render");
 * app.renderView.mission()?.source.name; // "Galaxy A26"
 * ```
 */
export type RenderViewApi = {
  /**
   * Re-reads the asset manifest and the calibration from game.locate or game.rect (the Textures
   * card's Refresh and a device change). Live values come from the watches: this is not a poll.
   * Does nothing while the link is not live or paused.
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
   * The derived view data of the scene cards: the scene tiles (draw calls, textures, scene), visible
   * tree rows, texture rows (filter and sort applied), bundles, pools and the release log. Copies, never the live maps (spec/11 §2.4).
   *
   * @returns The snapshot.
   * @example
   * ```ts
   * // An MCP tool reports the render numbers of the connected game.
   * const { tiles } = app.renderView.snapshot();
   * tiles.drawCalls; // { kind: "absent" } in a production build
   * tiles.scene?.effects; // { particles: 18, emitters: 1, filters: 24, renderPasses: 49 } on game 0.0.3
   * tiles.effectsInstalled; // false on a game without the effects plugin, else absent
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

  /**
   * What Mission control shows now, in copies: the source, live or paused, the span, the selection,
   * the frames header numbers, the rate, Monitoring, memory and the recording.
   *
   * @returns The view; undefined without an active source.
   * @example
   * ```ts
   * // An MCP tool reports what the Render workspace shows.
   * app.renderView.mission()?.source.name; // "Galaxy A26"
   * ```
   */
  mission(): MissionView | undefined;

  /**
   * The inspector's summary of the view or its range view of the selection, in copies (the same
   * derivation the component renders).
   *
   * @returns The inspector; undefined without an active source.
   * @example
   * ```ts
   * app.renderView.select({ from: 4810, to: 4860 });
   * app.renderView.inspect()?.kind; // "range"
   * ```
   */
  inspect(): InspectorView | undefined;

  /**
   * Pauses the view (Space): freezes its end while the history keeps filling. No-op without frames.
   *
   * @example
   * ```ts
   * app.renderView.pause();
   * app.renderView.mission()?.live; // false
   * ```
   */
  pause(): void;

  /**
   * Back to live: the view follows the clock again and the selection is cleared.
   *
   * @example
   * ```ts
   * app.renderView.live();
   * app.renderView.mission()?.selection; // undefined
   * ```
   */
  live(): void;

  /**
   * Sets the view's span (6 s, 30 s or 2 min); the view end is kept.
   *
   * @param span - 6000, 30000 or 120000 ms.
   * @example
   * ```ts
   * app.renderView.setSpan(30_000);
   * app.renderView.mission()?.span; // 30000
   * ```
   */
  setSpan(span: MissionSpan): void;

  /**
   * Pauses and moves the view's end (source clock) through the history: the overview drag.
   *
   * @param endMs - The new end, clamped into the history.
   * @example
   * ```ts
   * app.renderView.seek(78_000);
   * app.renderView.mission()?.behindMs; // 12000: twelve seconds behind live
   * ```
   */
  seek(endMs: number): void;

  /**
   * Selects frames: pauses, clamps to the history, scrolls the range into view and starts the
   * detail read; undefined clears the selection.
   *
   * @param range - The frames, inclusive; undefined to clear.
   * @returns The range kept; undefined when no frame of it is in the history.
   * @example
   * ```ts
   * app.renderView.select({ from: 4810, to: 4860 }); // { from: 4810, to: 4860 }
   * ```
   */
  select(range: FrameRange | undefined): FrameRange | undefined;

  /**
   * Steps one frame from the selection (no selection: the frame at the centre of the view).
   *
   * @param dir - 1 for the next frame, -1 for the previous.
   * @returns The frame selected; undefined at an end or without frames.
   * @example
   * ```ts
   * app.renderView.select({ from: 4851, to: 4851 });
   * app.renderView.step(1); // 4852
   * ```
   */
  step(dir: 1 | -1): number | undefined;

  /**
   * Jumps to the next or previous spike group, GC or rate change in the history and selects it; a
   * toast says so when there is none.
   *
   * @param kind - What to jump to.
   * @param dir - 1 for later, -1 for earlier.
   * @returns The range selected; undefined when there is none.
   * @example
   * ```ts
   * app.renderView.jump("spike", 1); // { from: 4851, to: 4853 }
   * ```
   */
  jump(kind: "spike" | "gc" | "rate", dir: 1 | -1): FrameRange | undefined;

  /**
   * Runs `game.frameRate` on the active source: `{ fps: 60 }`, `{ fps: 120 }` or `{}` for adaptive.
   * Never rejects: a refusal or a held pin is `{ ok: false, text }`; a call while one is pending
   * answers "Busy: a rate change is still pending" at once.
   *
   * @param choice - 60, 120 or "adaptive".
   * @returns The answer.
   * @example
   * ```ts
   * await app.renderView.setRate(120); // { ok: true, choice: 120, text: "Pinned at 120, adaptive off", fps: 120, mode: "fixed" }
   * ```
   */
  setRate(choice: RateChoice): Promise<RateAnswer>;

  /**
   * Runs `editor.perf.sections` with a Monitoring row's keys (`gpu`, `memory`, `systems`, `nodes`,
   * `passes` + `shaders`); Frames and Render stats are always on. Never rejects.
   *
   * @param section - The row.
   * @param on - Turn it on or off.
   * @returns The answer with every row's state.
   * @example
   * ```ts
   * await app.renderView.setSection("frames", false); // { ok: false, text: "Frames are always measured", sections: undefined }
   * ```
   */
  setSection(section: MonitorSection, on: boolean): Promise<SectionsAnswer>;

  /**
   * Runs `game.debug { overdraw }`: the overdraw heat map on the source (RE1).
   *
   * @param on - Turn it on or off.
   * @returns The engine's flag after it (the old flag on a refusal, with a toast).
   * @example
   * ```ts
   * await app.renderView.setOverdraw(true); // true
   * ```
   */
  setOverdraw(on: boolean): Promise<boolean>;

  /**
   * Runs `editor.record { on, label }` on the source (the hub stamps who: the log reads "started by
   * you"). Never rejects.
   *
   * @param on - Start or stop.
   * @param label - The log's label.
   * @returns The answer.
   * @example
   * ```ts
   * await app.renderView.record(true, "boss intro"); // { ok: true, text: "Recording on Galaxy A26", file: "perf-20261016-1102-sm-a266b.jsonl" }
   * ```
   */
  record(on: boolean, label?: string): Promise<RecordAnswer>;

  /**
   * Runs `editor.record { mark }`: marks the recording; an empty label becomes "mark {n + 1}".
   *
   * @param label - The mark's label.
   * @returns The answer's `marked`; false when nothing records.
   * @example
   * ```ts
   * await app.renderView.mark("boss intro"); // true
   * ```
   */
  mark(label?: string): Promise<boolean>;
};

/**
 * Domain context of renderView: the kernel context is assignable to it.
 */
export type RenderViewCtx = {
  readonly config: Readonly<RenderViewConfig>;
  state: RenderViewState;
  readonly emit: EmitFn<Pick<ToolsEvents, "workspace:inspect" | "workspace:open-file">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * renderView's hooks: the global tools events (R4) and activeSource's per-plugin events (spec 09
 * § M12), visible through `depends`.
 */
export type RenderViewHooks = {
  readonly "workspace:changed": (payload: ToolsEvents["workspace:changed"]) => void;
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
  readonly "link:project": (payload: ToolsEvents["link:project"]) => void;
  readonly "workspace:reveal": (payload: ToolsEvents["workspace:reveal"]) => void;
  readonly "activeSource:changed": (change: SourceChange) => void;
  readonly "activeSource:connect-requested": (request: ConnectRequest) => void;
};
