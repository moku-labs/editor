/**
 * @file flowView layout module — types and geometry constants (design §6 G, §7): pins file,
 * layout engine, layout state, the flows and layout namespaces of the api.
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
 * The laid-out content of one flow, before composition.
 */
export type FlowBox = {
  readonly items: readonly Item[];
  readonly edges: readonly EdgePath[];
  readonly lanes: readonly LaneBand[];
  readonly heads: readonly ColumnHead[];
  readonly bounds: Rect;
};

/**
 * Where a note sits.
 */
export type NoteAnchor = {
  readonly path: string;
  readonly flow: string;
  readonly from: { readonly node: NodeId; readonly outcome?: string } | undefined;
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
  saving: Promise<void> | undefined;
  /** Created lazily on the first non-hub layout. */
  engine: LayoutEngine | undefined;
};

/**
 * The flows namespace of the api.
 */
export type FlowsApi = {
  expand(key: ItemKey): void;
  collapse(key: ItemKey): void;
  /** Enter a sub-flow node as its own canvas. */
  enter(key: ItemKey): void;
  /** Leave entered flows up to depth (0 = main); breadcrumb segments call it (M1). */
  up(depth: number): void;
};

/**
 * The layout namespace of the api.
 */
export type LayoutApi = {
  /** Pinned items in the visible flows. */
  pinnedCount(): number;
  /** Clear pins of the visible flows, write layout.json, toast; rejects when nothing is pinned. */
  reset(): Promise<void>;
};
