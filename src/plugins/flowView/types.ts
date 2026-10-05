/**
 * @file flowView plugin — root type definitions: config, node ids, the wire shapes parsed by
 * data.ts, the render types shared across modules (Camera, Item, EdgePath, LayoutResult), the
 * composed state, the namespaced api, the internal actions and services every module gets, the
 * domain context and the hooks. Module-local types live in each module's types.ts; module folders
 * never import each other (spec/15 §2.5): they reach each other through `FlowEnvironment.actions()`.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type { FilesClient } from "../link/types";
import type { Json, LinkStatus, RunResult, ToolsBoot } from "../registry/protocol";
import type { PreviewState, ReloadResult } from "../workspace/types";
import type { CameraActions, CameraApi, CameraState } from "./camera/types";
import type { FocusActions, FocusApi, FocusState } from "./focus/types";
import type { InspectorActions, InspectorState } from "./inspector/types";
import type { FlowsApi, LayoutActions, LayoutApi, LayoutState } from "./layout/types";

/**
 * Where the layout is saved and how ELK runs (`flowView.layout`). Replaced as a whole: an override
 * gives every field.
 *
 * @example
 * ```ts
 * createApp({
 *   pluginConfigs: {
 *     flowView: { layout: { file: ".moku/editor/layout.json", worker: false, saveDelayMs: 400 } }
 *   }
 * }); // ELK runs inline, positions save to .moku/editor/layout.json
 * ```
 */
export type FlowLayoutConfig = {
  /** Saved positions. Default ".moku/editor/layout.json". */
  readonly file: string;
  /** Run ELK in a Web Worker; false = inline (tests, strict CSP). Default true. */
  readonly worker: boolean;
  /** Debounce before the layout file is written after a drop. Default 400. */
  readonly saveDelayMs: number;
};

/**
 * The zoom range of the camera (`flowView.zoom`). Replaced as a whole: an override gives every
 * field.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { flowView: { zoom: { min: 0.08, max: 2, defaultMin: 0.8 } } } });
 * // zoomTo(3) stops at 200 %
 * ```
 */
export type FlowZoomConfig = {
  /** Lowest zoom (design §4: 8 %). Default 0.08. */
  readonly min: number;
  /** Highest zoom (design §4: 300 %). Default 3. */
  readonly max: number;
  /** Floor of the default camera (M11). Default 0.8. */
  readonly defaultMin: number;
};

/**
 * The hub rule (`flowView.hub`, design §7.1): the rest node drawn as a hub with one lane per
 * outcome. Replaced as a whole: an override gives every field.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { flowView: { hub: { minOutcomes: 8, minReturns: 4 } } } });
 * // a rest node with 6 outcomes is laid out by ELK, not as a hub
 * ```
 */
export type FlowHubConfig = {
  /** A hub has at least this many outcomes. Default 6. */
  readonly minOutcomes: number;
  /** A hub has at least this many distinct returning nodes. Default 4. */
  readonly minReturns: number;
};

/**
 * flowView configuration (spec/11 §2.6): flat fields plus the one-level objects `layout`, `zoom`
 * and `hub`. The kernel merges shallowly, so an object given in `pluginConfigs` replaces the
 * default object as a whole.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { flowView: { stylesFile: "src/ui/styles.ts" } } });
 * ```
 */
export type FlowViewConfig = {
  /** Entries of game.history flowView watches. Default 20. */
  historyLast: number;
  /** Edges drawn as the trail, newest strongest. Default 6. */
  trailLength: number;
  /** Outcome names drawn as rejections. Default ["rejected"]. */
  rejectedOutcomes: readonly string[];
  /**
   * The text-styles file the Styles tab reads and edits. Default undefined: found once per session
   * as the first `.ts`/`.tsx` file under the link root that calls `defineTextStyles(`.
   */
  stylesFile: string | undefined;
  /** Debounce before a style stepper burst is written. Default 600. */
  styleSaveDelayMs: number;
  /** The layout file and the ELK engine. */
  layout: FlowLayoutConfig;
  /** The zoom range of the camera. */
  zoom: FlowZoomConfig;
  /** The hub rule. */
  hub: FlowHubConfig;
};

/**
 * A graph node id: "<flow>/<node>", e.g. "board/merge".
 */
export type NodeId = string; // eslint-disable-line sonarjs/redundant-type-aliases -- the spec names node ids

/**
 * An item instance key: a NodeId in the root frame, "<parentKey>>" + NodeId inside an expanded sub-flow.
 */
export type ItemKey = string; // eslint-disable-line sonarjs/redundant-type-aliases -- the spec names instance keys

/**
 * One graph node on the wire (game.graph). `file` arrives with game follow-up F-H2 (dev only).
 */
export type GraphNodeJson = {
  flow: string;
  node: string;
  rest: boolean;
  over: boolean;
  checkpoint: boolean;
  barrier: boolean;
  scene?: string;
  outcomes: string[];
  slot?: string;
  subFlow?: string;
  owner?: string;
  file?: string;
};

/**
 * One flow of the graph.
 */
export type FlowJson = {
  nodes: Record<string, GraphNodeJson>;
  start: string;
  edges: Record<string, Record<string, string>>;
};

/**
 * One contribution to a slot.
 */
export type SlotContribution = { feature: string; flow: string; order: number };

/**
 * game.graph as flowView reads it.
 */
export type GraphJson = {
  main: string;
  flows: Record<string, FlowJson>;
  slots: Record<string, SlotContribution[]>;
};

/**
 * game.position as flowView reads it.
 */
export type PositionJson = {
  path: string;
  flow?: string;
  node?: string;
  waiting: readonly string[];
};

/**
 * One game.history entry; `frame` arrives with game follow-up F-H1.
 */
export type HistoryEntryJson = {
  index: number;
  path: string;
  outcome: string;
  payload: Json;
  next: string;
  now: number;
  hash: string;
  frame?: number;
};

/**
 * The camera: screen = world · z + (x, y).
 */
export type Camera = { x: number; y: number; z: number };

/**
 * A world rect.
 */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * What a laid-out item is.
 */
export type ItemKind = "node" | "hub" | "frame" | "stub" | "port";

/**
 * One laid-out item, in world coordinates.
 */
export type Item = {
  key: ItemKey;
  /** The node id; the flow name for the root frame. */
  id: NodeId;
  kind: ItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The flow the item sits in. */
  flow: string;
  parent?: ItemKey;
  pinned: boolean;
  /** Outcome → y offset of its port from the item top. */
  ports?: Record<string, number>;
  label?: string;
  /** Stubs: the node the stub stands for. */
  target?: NodeId;
};

/**
 * One routed edge.
 */
export type EdgePath = {
  /** "<id>:<outcome>", instance-prefixed like `from` ("main/board>board/merge:done"). */
  key: string;
  from: ItemKey;
  to: ItemKey | undefined;
  outcome: string;
  kind: "edge" | "return";
  points: readonly { x: number; y: number }[];
  label?: string;
  /** The label centre ELK or the lane label pass placed; absent = the first segment's midpoint. */
  labelAt?: { x: number; y: number };
};

/**
 * One hub lane band.
 */
export type LaneBand = {
  index: number;
  outcome: string;
  x: number;
  y: number;
  w: number;
  h: number;
  trail: boolean;
};

/**
 * A column head above the lanes.
 */
export type ColumnHead = { label: string; x: number; y: number };

/**
 * The output of the layout.
 */
export type LayoutResult = {
  root: string;
  items: Item[];
  byKey: Record<ItemKey, Item>;
  edges: EdgePath[];
  lanes: LaneBand[];
  heads: ColumnHead[];
  bounds: Rect;
  frames: Item[];
  /** "<frame key>|<flow>" → world point of that flow's content origin (pins are relative to it). */
  origins: Record<string, { x: number; y: number }>;
};

/**
 * The Flow panel's commands (declared on the panel; flowView runs them through panels.run, R9).
 */
export type FlowCommands = {
  readonly step: "game.step";
  readonly pause: "game.pause";
  readonly resume: "game.resume";
};

/**
 * The sources flowView watches for the whole session (R6), whatever workspace shows. The Flow
 * panel declares none.
 */
export type FlowSources = {
  readonly graph: "game.graph";
  readonly position: "game.position";
  readonly history: readonly ["game.history", { readonly last: number }];
};

/**
 * The latest value of each session watch, as it came over the wire (data.ts parses them).
 */
export type FlowValues = { readonly [K in keyof FlowSources]: Json };

/**
 * An intent of another view (`workspace:select-node`, `workspace:focus-frame`). One that comes
 * before the first flow values waits for them.
 */
export type FlowIntent =
  | { readonly kind: "select"; readonly id: string }
  | { readonly kind: "frame"; readonly frame: number };

/**
 * Composed flowView state (never exposed by reference).
 */
export type FlowViewState = {
  data: {
    graph: GraphJson | undefined;
    graphHash: string;
    position: PositionJson | undefined;
    history: readonly HistoryEntryJson[];
    status: LinkStatus;
    stale: boolean;
    staleFrame: number | undefined;
    /** Session of the last link:status. */
    session: string | undefined;
    /** The session whose layout and style keys were loaded; undefined before the first load. */
    loaded: { session: string | undefined } | undefined;
    /** The latest value of each session watch; they go in once all three arrived. */
    values: { -readonly [K in keyof FlowValues]: Json | undefined };
    /** The intent that came before the first flow values; the latest wins. */
    pending: FlowIntent | undefined;
  };
  camera: CameraState;
  layout: LayoutState;
  focus: FocusState;
  inspector: InspectorState;
  view: {
    active: boolean;
    root: HTMLElement | undefined;
    listeners: Set<() => void>;
    /** Subscribers of camera moves only (zoom readout, minimap viewport, "You are here", labels). */
    cameraListeners: Set<() => void>;
    revision: number;
    timers: Set<ReturnType<typeof setTimeout>>;
    files: FilesClient | undefined;
    removers: (() => void)[];
    /** Removers of the replaceable palette groups (Nodes, Styles). */
    palette: { nodes: (() => void) | undefined; styles: (() => void) | undefined };
  };
};

/**
 * The flowView api (`app.flowView`), namespaced (spec/15 §2.5).
 *
 * @example
 * ```ts
 * app.flowView.focus.select("board/merge"); // true, the Inspector shows board/merge
 * app.flowView.camera.fitAll(); // the whole main frame in view
 * ```
 */
export type FlowViewApi = {
  /**
   * The camera: fit all, fit the selection, zoom, Follow the game.
   *
   * @example
   * ```ts
   * app.flowView.camera.zoomTo(1); // 100 %
   * ```
   */
  camera: CameraApi;

  /**
   * Focus: select a node, walk the graph, follow an edge, focus the edge of a frame, Step, the
   * history strip.
   *
   * @example
   * ```ts
   * app.flowView.focus.select("board/merge"); // true, the Inspector shows board/merge
   * ```
   */
  focus: FocusApi;

  /**
   * Sub-flows: expand and collapse in place, enter as the canvas root, go back up.
   *
   * @example
   * ```ts
   * app.flowView.flows.enter("main/board"); // breadcrumb main › board
   * ```
   */
  flows: FlowsApi;

  /**
   * Pinned positions: how many are pinned in the visible flows, and Reset layout.
   *
   * @example
   * ```ts
   * // merge and toast were dragged on the board.
   * app.flowView.layout.pinnedCount(); // 2
   * ```
   */
  layout: LayoutApi;
};

/**
 * Every internal action of flowView, grouped by module: the public api plus what the components,
 * the hooks and the other modules call. Built once per state by `actionsOf(ctx)`.
 */
export type FlowActions = {
  readonly camera: CameraActions;
  readonly focus: FocusActions;
  readonly flows: FlowsApi;
  readonly layout: LayoutActions;
  readonly inspector: InspectorActions;
};

/**
 * The other plugins as flowView uses them: thin closures over `ctx.require` (link, workspace,
 * panels) and `ctx.emit`.
 */
export type FlowServices = {
  /** link.files (R4). */
  readonly files: () => FilesClient;
  /** workspace.toast(message, file?) (M12). */
  readonly toast: (message: string, file?: string) => void;
  /** panels.run(id, input) (R9): emits workspace:ran. */
  readonly run: (id: string, input?: Json) => Promise<RunResult>;
  /** link.status(). */
  readonly status: () => LinkStatus;
  /** link.boot(). */
  readonly boot: () => ToolsBoot | undefined;
  /** workspace.show("flow"). */
  readonly show: () => void;
  /** Whether Flow is the shown workspace (workspace.active()). */
  readonly active: () => boolean;
  /**
   * The reload after a save written at `since` (epoch ms taken before the write):
   * workspace.gameFrame().reload({ restore: true, afterSave: true, since }) (D-07).
   */
  readonly reload: (since: number) => Promise<ReloadResult>;
  /** workspace.preview("flow"). */
  readonly preview: () => PreviewState;
  /** Emits the global workspace:open-file (R4). */
  readonly openFile: (path: string, line?: number) => void;
  /** Replaces the palette group "Styles" with one item per text-style key. */
  readonly setStyleItems: (keys: readonly string[]) => void;
};

/**
 * What every module factory gets next to the context: the services and the late-bound actions.
 */
export type FlowEnvironment = FlowServices & { readonly actions: () => FlowActions };

/**
 * Domain context of flowView: the kernel context is assignable to it.
 */
export type FlowCtx = {
  readonly config: Readonly<FlowViewConfig>;
  state: FlowViewState;
  readonly emit: EmitFn<Pick<ToolsEvents, "workspace:open-file">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * flowView's hooks (all global tools events, R4).
 */
export type FlowHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
  readonly "workspace:changed": (payload: ToolsEvents["workspace:changed"]) => void;
  readonly "workspace:select-node": (payload: ToolsEvents["workspace:select-node"]) => void;
  readonly "workspace:focus-frame": (payload: ToolsEvents["workspace:focus-frame"]) => void;
  readonly "workspace:density": (payload: ToolsEvents["workspace:density"]) => void;
};
