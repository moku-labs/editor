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
import type { PanelValues } from "../panels/types";
import type { Json, LinkStatus, RunResult, ToolsBoot } from "../registry/protocol";
import type { PreviewState, ReloadResult } from "../workspace/types";
import type { CameraActions, CameraApi, CameraState } from "./camera/types";
import type { FocusActions, FocusApi, FocusState } from "./focus/types";
import type { InspectorApi, InspectorState } from "./inspector/types";
import type { FlowsApi, LayoutActions, LayoutApi, LayoutState } from "./layout/types";
import type { NotesActions, NotesApi, NotesState } from "./notes/types";

/**
 * flowView configuration (flat, spec/11 §2.6).
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { flowView: { stylesFile: "src/ui/styles.ts" } } });
 * ```
 */
export type FlowViewConfig = {
  /** Entries of game.history the panel watches. Default 20. */
  historyLast: number;
  /** Edges drawn as the trail, newest strongest. Default 6. */
  trailLength: number;
  /** Outcome names drawn as rejections. Default ["rejected"]. */
  rejectedOutcomes: readonly string[];
  /** Hub rule: a hub has at least this many outcomes (design §7.1). Default 5. */
  hubMinOutcomes: number;
  /** Hub rule: a hub has at least this many distinct returning nodes (design §7.1). Default 4. */
  hubMinReturns: number;
  /** Saved positions. Default ".moku/editor/layout.json". */
  layoutFile: string;
  /** Note files. Default ".moku/notes". */
  notesDir: string;
  /** The text-styles file the Styles tab reads and edits. Default "features/ui/styles.ts". */
  stylesFile: string;
  /** Run ELK in a Web Worker; false = inline (tests, strict CSP). Default true. */
  layoutWorker: boolean;
  /** Debounce before layout.json is written after a drop. Default 400. */
  layoutSaveDelayMs: number;
  /** Debounce before a style stepper burst is written. Default 600. */
  styleSaveDelayMs: number;
  /** Lowest zoom (design §4: 8 %). Default 0.08. */
  minZoom: number;
  /** Highest zoom (design §4: 300 %). Default 3. */
  maxZoom: number;
  /** Floor of the default camera (M11). Default 0.8. */
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
export type ItemKind = "node" | "hub" | "frame" | "stub" | "note" | "port";

/**
 * One laid-out item, in world coordinates.
 */
export type Item = {
  key: ItemKey;
  /** The node id; the flow name for the root frame, the file path for a note. */
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
  /** "<frame key>|<flow>" → world point of that flow's content origin (pins are relative to it). */
  origins: Record<string, { x: number; y: number }>;
};

/**
 * Where a note sits: its flow ("" = the root frame) and, for an anchored note, its node and outcome.
 */
export type NoteAnchor = {
  readonly path: string;
  readonly flow: string;
  readonly from: { readonly node: NodeId; readonly outcome?: string } | undefined;
  readonly title: string;
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
    /** Session of the last link:status. */
    session: string | undefined;
    /** The session whose layout, notes and style keys were loaded; undefined before the first load. */
    loaded: { session: string | undefined } | undefined;
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
 * app.flowView.focus.select("board/merge"); // true, the neighbours strip opens
 * app.flowView.camera.fitAll(); // the whole main frame in view
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
 * Every internal action of flowView, grouped by module: the public api plus what the components,
 * the hooks and the other modules call. Built once per state by `actionsOf(ctx)`.
 */
export type FlowActions = {
  readonly camera: CameraActions;
  readonly focus: FocusActions;
  readonly flows: FlowsApi;
  readonly layout: LayoutActions;
  readonly notes: NotesActions;
  readonly inspector: InspectorApi;
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
  /** link.read(id): a one-shot read. */
  readonly read: (id: string) => Promise<Json>;
  /** link.boot(). */
  readonly boot: () => ToolsBoot | undefined;
  /** workspace.show("flow"). */
  readonly show: () => void;
  /** Whether Flow is the shown workspace (workspace.active()). */
  readonly active: () => boolean;
  /** workspace.gameFrame().reload({ restore: true }) (D-07). */
  readonly reload: () => Promise<ReloadResult>;
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
  readonly "workspace:new-note": (payload: ToolsEvents["workspace:new-note"]) => void;
};
