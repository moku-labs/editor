/**
 * @file flowView focus module — types: focus state, context menu, node kinds, stack entries,
 * neighbour edges, the focus api.
 */
import type { RunResult } from "../../registry/protocol";
import type { ItemKey, NodeId } from "../types";

/**
 * An open context menu.
 */
export type MenuState = {
  readonly target: "node" | "outcome" | "canvas";
  readonly key: ItemKey | undefined;
  readonly outcome: string | undefined;
  readonly x: number;
  readonly y: number;
};

/**
 * Focus module state.
 */
export type FocusState = {
  selected: ItemKey | undefined;
  /** Selected edge key "<id>:<outcome>". */
  edge: string | undefined;
  strip: boolean;
  highlight: { side: "from" | "to"; index: number };
  historyOpen: boolean;
  historySelected: number | undefined;
  historyHover: number | undefined;
  /** Entry index → frame seen live (until F-H1). */
  frames: Map<number, number>;
  menu: MenuState | undefined;
};

/**
 * A node kind (tag and glyph).
 */
export type NodeKind =
  | "start"
  | "rest"
  | "transit"
  | "sub-flow"
  | "slot"
  | "checkpoint"
  | "over"
  | "barrier";

/**
 * One level of the runtime stack.
 */
export type StackEntry = { readonly flow: string; readonly node: string; readonly id: NodeId };

/**
 * One outgoing edge of a node, in declared order.
 */
export type OutgoingEdge = {
  readonly outcome: string;
  readonly key: string;
  readonly to: NodeId | undefined;
  readonly exit?: string;
  readonly back: boolean;
};

/**
 * One incoming edge of a node.
 */
export type IncomingEdge = {
  readonly from: NodeId;
  readonly outcome: string;
  readonly key: string;
  /** The parent sub-flow node when the edge enters through the flow start. */
  readonly via: NodeId | undefined;
};

/**
 * The focus namespace of the api.
 */
export type FocusApi = {
  /** Select = focus; undefined leaves focus; false for an unknown key. */
  select(key: ItemKey | NodeId | undefined): boolean;
  selected(): ItemKey | undefined;
  /** Node id of the current position. */
  current(): NodeId | undefined;
  walk(direction: "prev" | "next"): void;
  /** Focus the edge taken at a frame; false when no frame data. */
  focusFrame(frame: number): boolean;
  /** game.step { frames: 1 } through panels.run (R9); no-op unless paused (M5). */
  step(): Promise<RunResult | undefined>;
  /** Toggle the history strip. */
  history(open?: boolean): boolean;
};
