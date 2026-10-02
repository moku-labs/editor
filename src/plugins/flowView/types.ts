/**
 * @file flowView plugin — root type definitions: config, node ids, the wire shapes parsed by
 * data.ts, the render types shared across modules (Camera, Item, EdgePath, LayoutResult), the
 * composed state, the namespaced api, the domain context and the hooks. Module-local types live
 * in each module's types.ts; module folders never import each other (spec/15 §2.5).
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type { FilesClient } from "../link/types";
import type { PanelValues } from "../panels/types";
import type { Json, LinkStatus } from "../registry/protocol";
import type { CameraApi, CameraState } from "./camera/types";
import type { FocusApi, FocusState } from "./focus/types";
import type { InspectorState } from "./inspector/types";
import type { FlowsApi, LayoutApi, LayoutState } from "./layout/types";
import type { NotesApi, NotesState } from "./notes/types";

/**
 * flowView configuration (flat, spec/11 §2.6).
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { flowView: { stylesFile: "src/ui/styles.ts" } } });
 * ```
 */
export type FlowViewConfig = {
  /** Entries of game.history the panel watches. */
  historyLast: number;
  /** Edges drawn as the trail, newest strongest. */
  trailLength: number;
  /** Outcome names drawn as rejections. */
  rejectedOutcomes: readonly string[];
  /** Hub rule thresholds (design §7.1). */
  hubMinOutcomes: number;
  hubMinReturns: number;
  /** Saved positions. */
  layoutFile: string;
  /** Note files. */
  notesDir: string;
  /** The text-styles file the Styles tab reads and edits. */
  stylesFile: string;
  /** Run ELK in a Web Worker; false = inline (tests, strict CSP). */
  layoutWorker: boolean;
  /** Debounce before layout.json is written after a drop. */
  layoutSaveDelayMs: number;
  /** Debounce before a style stepper burst is written. */
  styleSaveDelayMs: number;
  /** Zoom range (design §4: 8 %–300 %). */
  minZoom: number;
  maxZoom: number;
  /** Floor of the default camera (M11). */
  defaultMinZoom: number;
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
 * One graph node on the wire (game.graph).
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
 * game.graph as flowView reads it.
 */
export type GraphJson = {
  main: string;
  flows: Record<string, FlowJson>;
  slots: Record<string, { feature: string; flow: string; order: number }[]>;
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
export type ItemKind = "node" | "hub" | "frame" | "stub" | "note" | "port";

/**
 * One laid-out item.
 */
export type Item = {
  key: ItemKey;
  id: NodeId;
  kind: ItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  flow: string;
  parent?: ItemKey;
  pinned: boolean;
  ports?: Record<string, number>;
  label?: string;
  target?: NodeId;
};

/**
 * One routed edge.
 */
export type EdgePath = {
  /** "<id>:<outcome>". */
  key: string;
  from: ItemKey;
  to: ItemKey | undefined;
  outcome: string;
  kind: "edge" | "return" | "note";
  points: readonly { x: number; y: number }[];
  label?: string;
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
 * The Flow panel's sources.
 */
export type FlowSources = {
  readonly graph: "game.graph";
  readonly position: "game.position";
  readonly history: readonly ["game.history", { readonly last: number }];
};

/**
 * The values the Flow panel view gets.
 */
export type FlowValues = PanelValues<FlowSources>;

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
  };
  camera: CameraState;
  layout: LayoutState;
  focus: FocusState;
  notes: NotesState;
  inspector: InspectorState;
  view: {
    active: boolean;
    root: HTMLElement | undefined;
    listeners: Set<() => void>;
    revision: number;
    timers: Set<ReturnType<typeof setTimeout>>;
    files: FilesClient | undefined;
    removers: (() => void)[];
  };
};

/**
 * The flowView api (`app.flowView`), namespaced (spec/15 §2.5).
 *
 * @example
 * ```ts
 * app.flowView.focus.select("board/merge");
 * app.flowView.camera.fitAll();
 * ```
 */
export type FlowViewApi = {
  camera: CameraApi;
  focus: FocusApi;
  flows: FlowsApi;
  layout: LayoutApi;
  notes: NotesApi;
};

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
  readonly "workspace:new-note": (payload: ToolsEvents["workspace:new-note"]) => void;
};
