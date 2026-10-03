/**
 * @file flowView layout module — types and geometry constants (design §6 G, §7): pins file,
 * layout engine, flow boxes, compose input, layout state, the flows and layout namespaces of the
 * api and the internal layout actions.
 */
import type { ElkNode } from "elkjs";
import type { Json } from "../../registry/protocol";
import type {
  ColumnHead,
  EdgePath,
  FlowViewConfig,
  GraphJson,
  Item,
  ItemKey,
  LaneBand,
  LayoutResult,
  NodeId,
  NoteAnchor,
  Rect
} from "../types";

/**
 * Node card width.
 */
export const NODE_W = 172;
/**
 * Node card height.
 */
export const NODE_H = 44;
/**
 * Row height of a lane.
 */
export const ROW = 46;
/**
 * Gap between columns.
 */
export const COL_GAP = 150;
/**
 * Hub width.
 */
export const HUB_W = 200;
/**
 * Hub head height.
 */
export const HUB_HEAD = 72;
/**
 * Gap between the hub and column 1.
 */
export const HUB_GAP = 64;
/**
 * Grid snap of dragged items.
 */
export const SNAP = 12;
/**
 * Return stub width.
 */
export const STUB_W = 120;
/**
 * Return stub height.
 */
export const STUB_H = 24;
/**
 * Note width (height 112, grows up to 180).
 */
export const NOTE_W = 236;
/**
 * Note height.
 */
export const NOTE_H = 112;
/**
 * Frame padding.
 */
export const FRAME_PAD = 22;
/**
 * Frame head height.
 */
export const FRAME_HEAD = 40;
/**
 * Port size.
 */
export const PORT = 12;
/**
 * Lane padding.
 */
export const LANE_PAD = 5;
/**
 * ELK node-node spacing.
 */
export const NODE_SPACING = 24;

/**
 * `.moku/editor/layout.json`: positions per node id and per note file.
 */
export type PinsFile = {
  version: 1;
  nodes: Record<NodeId, { x: number; y: number }>;
  notes: Record<string, { flow: string; x: number; y: number }>;
  /** Unknown top-level keys, kept on write. */
  extra: Record<string, Json>;
};

/**
 * The ELK runner: a worker (default) or inline.
 */
export type LayoutEngine = {
  layout(input: ElkNode): Promise<ElkNode>;
  dispose(): void;
};

/**
 * How the DFS classified one edge of a flow (design §7.6).
 */
export type EdgeClass = "forward" | "back" | "short-loop";

/**
 * Sizes of the nodes that are not plain cards (expanded sub-flow boxes), by node name.
 */
export type NodeSizes = ReadonlyMap<string, { readonly w: number; readonly h: number }>;

/**
 * The laid-out content of one flow, before composition: coordinates relative to the flow's
 * content origin, keys local (node ids, `stub:<id>:<outcome>`, `exit:<name>`, `entry`).
 */
export type FlowBox = {
  readonly items: readonly Item[];
  readonly edges: readonly EdgePath[];
  readonly lanes: readonly LaneBand[];
  readonly heads: readonly ColumnHead[];
  readonly bounds: Rect;
  /** Nodes the hub-lane walk did not reach (laid out as an ELK block under the lanes). */
  readonly unreached: readonly string[];
};

/**
 * Everything the composition needs (deterministic: same input, same result).
 */
export type ComposeInput = {
  readonly graph: GraphJson;
  readonly root: string;
  readonly expanded: ReadonlySet<ItemKey>;
  readonly pins: PinsFile;
  readonly notes: readonly NoteAnchor[];
  readonly config: Readonly<FlowViewConfig>;
  readonly engine: LayoutEngine;
};

/**
 * Layout module state.
 */
export type LayoutState = {
  result: LayoutResult | undefined;
  /** Request counter; a stale result is dropped. */
  seq: number;
  /** LRU 8. */
  cache: Map<string, LayoutResult>;
  expanded: Set<ItemKey>;
  /** Entered flows (breadcrumb). */
  enter: { flow: string; via: NodeId }[];
  pins: PinsFile;
  pinsVersion: string | undefined;
  /** layout.json is invalid: never written. */
  pinsReadOnly: boolean;
  /** Node ids and note paths changed since the last save (re-applied after a conflict). */
  dirty: Set<string>;
  saving: Promise<void> | undefined;
  /** Created lazily on the first non-hub layout. */
  engine: LayoutEngine | undefined;
};

/**
 * The flows namespace of the api (`app.flowView.flows`).
 */
export type FlowsApi = {
  /**
   * Expands a sub-flow or slot item in place (design §7.5).
   *
   * @param key - The item key of a sub-flow or slot node.
   * @example
   * ```ts
   * app.flowView.flows.expand("main/settings"); // the settingsPopup frame opens inside main
   * ```
   */
  expand(key: ItemKey): void;

  /**
   * Collapses an expanded sub-flow or slot item back to a card.
   *
   * @param key - The item key of the expanded node.
   * @example
   * ```ts
   * app.flowView.flows.collapse("main/board"); // the board hub folds into one card
   * ```
   */
  collapse(key: ItemKey): void;

  /**
   * Enters a sub-flow node as its own canvas (double-click, "Enter <flow>").
   *
   * @param key - The item key of a sub-flow node.
   * @example
   * ```ts
   * app.flowView.flows.enter("main/board"); // breadcrumb main › board
   * ```
   */
  enter(key: ItemKey): void;

  /**
   * Leaves entered flows up to a depth (0 = main). Breadcrumb segments call it (M1).
   *
   * @param depth - How many entered flows stay.
   * @example
   * ```ts
   * app.flowView.flows.up(0); // back to main
   * ```
   */
  up(depth: number): void;
};

/**
 * The layout namespace of the api (`app.flowView.layout`).
 */
export type LayoutApi = {
  /**
   * Pinned items (node and note positions) in the visible flows: Reset layout is disabled at 0 (M8).
   *
   * @returns The count.
   * @example
   * ```ts
   * // merge and toast were dragged on the board.
   * app.flowView.layout.pinnedCount(); // 2
   * ```
   */
  pinnedCount(): number;

  /**
   * Clears the pins of the visible flows, writes layout.json and toasts the file (M12).
   *
   * @returns Resolves when the file is written.
   * @throws {Error} When nothing is pinned or layout.json is not valid.
   * @example
   * ```ts
   * await app.flowView.layout.reset(); // toast "Layout reset · 3 pinned nodes · .moku/editor/layout.json"
   * ```
   */
  reset(): Promise<void>;
};

/**
 * The layout actions: the api plus what the components and the other modules call.
 */
export type LayoutActions = LayoutApi & {
  /** Lays out the graph again (cached, stale results dropped). */
  relayout(): Promise<void>;
  /** Reads layout.json (missing = empty, invalid = read-only), then lays out again. */
  loadPins(): Promise<void>;
  /** Pins a dragged node at a world position (snapped to 12) and schedules the save. */
  drop(key: ItemKey, x: number, y: number): void;
  /** Pins a note at a world position inside a flow frame (snapped) and schedules the save. */
  dropNote(path: string, flow: string, x: number, y: number): void;
  /** The flows on screen: the root and every expanded frame's flow. */
  visibleFlows(): ReadonlySet<string>;
  /** Expands the collapsed parents of a node id; returns the instance key it will get. */
  reveal(id: NodeId): ItemKey | undefined;
  /** The root flow: main, or the last entered flow. */
  root(): string;
  /** Applies the default expanded set: every sub-flow node on the current stack. */
  expandStack(): void;
};
