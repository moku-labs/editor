/**
 * @file flowView render module — the view data the Flow workspace computes for the canvas
 * components (cards, hubs, frames, stubs, edges, history rows).
 */
import type { ItemKey, LayoutResult } from "../types";

/**
 * The glyph of a node card: rest = accent pause bars, transit = grey arrow, sub-flow = teal stack,
 * slot = amber dashed square, start = ink dot.
 */
export type Glyph = "rest" | "transit" | "sub-flow" | "slot" | "start";

/**
 * What a node card shows.
 */
export type CardView = {
  readonly name: string;
  readonly glyph: Glyph;
  readonly kinds: readonly string[];
  readonly kindLine: string;
  readonly selected: boolean;
  readonly current: boolean;
  /**
   * Holds the current node: it is the current node, has it inside (a collapsed sub-flow, slot or
   * hub) or is on the position stack. Such a card never dims; when it is not the current node it
   * gets the accent ring and a "here" marker.
   */
  readonly holdsCurrent: boolean;
  /** Dimmed by a selection it is not related to; an item holding the current node never is. */
  readonly dimmed: boolean;
  /** The 600 ms pulse ring plays on it (a followed edge reached it, Find current). */
  readonly pulse: boolean;
  readonly trail: boolean;
  readonly onStack: boolean;
  readonly expandable: boolean;
  readonly expanded: boolean;
};

/**
 * What a hub shows: a card plus its port rows.
 */
export type HubView = CardView & {
  readonly outcomes: readonly string[];
  readonly waiting: readonly string[];
  readonly scene: string | undefined;
};

/**
 * What a frame shows.
 */
export type FrameView = {
  readonly head: string;
  readonly onStack: boolean;
  readonly root: boolean;
  readonly dimmed: boolean;
  /** The current node is inside it (never on a root frame): accent ring and a "here" marker. */
  readonly holdsCurrent: boolean;
};

/**
 * What a return stub shows.
 */
export type StubView = {
  readonly trail: boolean;
  /** "✕ rejected · frame 1778 · empty" when the edge's last fire was a rejection. */
  readonly rejected: string | undefined;
  readonly selected: boolean;
  readonly dimmed: boolean;
};

/**
 * How an edge is drawn.
 */
export type EdgeView = {
  /** Trail rank, newest 0. */
  readonly rank: number | undefined;
  /** One of the last three transitions (drawn 2 px accent at full strength). */
  readonly recent: boolean;
  readonly rejected: boolean;
  readonly related: boolean;
  /** A trail edge into an item holding the current node: drawn 2 px accent at full strength. */
  readonly here: boolean;
  readonly dimmed: boolean;
  readonly selected: boolean;
};

/**
 * Everything the world layer draws.
 */
export type WorldView = {
  readonly result: LayoutResult;
  readonly cards: ReadonlyMap<ItemKey, CardView>;
  readonly hubs: ReadonlyMap<ItemKey, HubView>;
  readonly frames: ReadonlyMap<ItemKey, FrameView>;
  readonly stubs: ReadonlyMap<ItemKey, StubView>;
  /** By edge id (`edgeId`). */
  readonly edges: ReadonlyMap<string, EdgeView>;
  /** Lane bands on the trail, by `laneId`. */
  readonly trailLanes: ReadonlySet<string>;
  readonly stale: boolean;
};

/**
 * One row of the history strip (newest first).
 */
export type HistoryRow = {
  readonly index: number;
  readonly label: string;
  readonly path: string;
  readonly outcome: string;
  readonly next: string;
  readonly payload: string;
  readonly trail: boolean;
  readonly rejected: boolean;
};
