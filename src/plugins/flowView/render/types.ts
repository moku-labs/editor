/**
 * @file flowView render module — the view data the Flow workspace computes for the canvas
 * components (cards, hubs, frames, stubs, notes, edges, history rows).
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
  readonly dimmed: boolean;
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
 * What a note node shows.
 */
export type NoteView = {
  readonly title: string;
  readonly lines: readonly string[];
  readonly captures: number;
  readonly status: string;
};

/**
 * How an edge is drawn.
 */
export type EdgeView = {
  /** Trail rank, newest 0. */
  readonly rank: number | undefined;
  readonly rejected: boolean;
  readonly related: boolean;
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
  readonly notes: ReadonlyMap<ItemKey, NoteView>;
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
