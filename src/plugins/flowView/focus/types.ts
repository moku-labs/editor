/**
 * @file flowView focus module — types: focus state, context menu, node kinds, stack entries,
 * neighbour edges, the public focus api and the internal focus actions.
 */
import type { RunResult } from "../../registry/protocol";
import type { Item, ItemKey, NodeId, Rect } from "../types";

/**
 * An open context menu (D4), in canvas px.
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
  /** Selected edge, instance-prefixed: "main/board>board/merge:done". */
  edge: string | undefined;
  /** The highlighted Info tab row: an Outcomes row ("to") or a Comes from row ("from"); -1 = none. */
  highlight: { side: "from" | "to"; index: number };
  /** Selections a followed edge left, newest last (Alt+← and the Inspector Back button return). */
  back: (ItemKey | undefined)[];
  /** The item the 600 ms pulse ring plays on (a followed edge's end, Find current). */
  pulse: ItemKey | undefined;
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
 * Where the current node is on the canvas: its own item, or the collapsed parent it is inside.
 */
export type CurrentSpot = { readonly item: Item; readonly inside: NodeId | undefined };

/**
 * The focus namespace of the api (`app.flowView.focus`).
 */
export type FocusApi = {
  /**
   * Select = focus (design §4): the camera moves, the rest dims, the Inspector shows the item.
   * A bare NodeId resolves to its first visible instance; inside a collapsed sub-flow the parents
   * expand first. `undefined` leaves focus.
   *
   * @param key - An ItemKey, a NodeId, or undefined.
   * @returns False for an unknown key, else true.
   * @example
   * ```ts
   * app.flowView.focus.select("board/merge"); // true, the Inspector shows board/merge
   * app.flowView.focus.select("board/nope"); // false, nothing selected
   * ```
   */
  select(key: ItemKey | NodeId | undefined): boolean;

  /**
   * The selected item key.
   *
   * @returns The key, or undefined when nothing is selected.
   * @example
   * ```ts
   * app.flowView.focus.select("main/home");
   * app.flowView.focus.selected(); // "main/home"
   * ```
   */
  selected(): ItemKey | undefined;

  /**
   * Node id of the current position, from game.position.
   *
   * @returns The id, or undefined before the first position.
   * @example
   * ```ts
   * // The game waits on the board.
   * app.flowView.focus.current(); // "board/awaitIntent"
   * ```
   */
  current(): NodeId | undefined;

  /**
   * Walks the graph from the shown node: "next" (→) follows the highlighted *Outcomes* row of the
   * Info tab (default: the row on the trail), "prev" (←) the highlighted *Comes from* row
   * (default: the first). A row with its edge on screen is followed like `followEdge`.
   *
   * @param direction - "prev" = ←, "next" = →.
   * @example
   * ```ts
   * app.flowView.focus.select("board/merge");
   * app.flowView.focus.walk("next"); // focus moves to "board/awaitIntent", the "Outcomes" row
   * ```
   */
  walk(direction: "prev" | "next"): void;

  /**
   * Follows an edge from the shown node to its other end: the target of an *Outcomes* edge, the
   * source of a *Comes from* edge (an exit resolves through its frame's edge). Selects that
   * instance, marks the edge, frames both ends, plays a 600 ms pulse on the reached node and
   * keeps the previous selection for Back (Alt+←).
   *
   * @param edgeKey - An instance edge key, "main/board>board/merge:done".
   * @returns False when the edge or its other end is not on the canvas, else true.
   * @example
   * ```ts
   * app.flowView.focus.select("board/merge");
   * app.flowView.focus.followEdge("main/board>board/merge:done"); // true: awaitIntent selected, both ends framed
   * ```
   */
  followEdge(edgeKey: string): boolean;

  /**
   * Focuses the edge taken at a frame and marks its history row (the `workspace:focus-frame` hook
   * calls it), then toasts "Frame N · path · outcome", or "No edge at frame N · last edge before
   * it …".
   *
   * @param frame - A game frame.
   * @returns False when the history carries no frames (until F-H1), else true.
   * @example
   * ```ts
   * app.flowView.focus.focusFrame(1778); // true: selects edge board/merge:rejected and its row
   * ```
   */
  focusFrame(frame: number): boolean;

  /**
   * Runs game.step { frames: 1 } through panels.run (R9). Does nothing unless the game is paused
   * (M5); a failed run is logged and toasted, and resolves undefined.
   *
   * @returns The run result, or undefined when not paused or failed.
   * @example
   * ```ts
   * await app.flowView.focus.step(); // { value, state: { path, frame, tainted } } or undefined
   * ```
   */
  step(): Promise<RunResult | undefined>;

  /**
   * Toggles or sets the history strip (H).
   *
   * @param open - The new value; omitted = toggle.
   * @returns Whether the strip is open.
   * @example
   * ```ts
   * app.flowView.focus.history(true); // true: 288 px strip with 20 rows
   * ```
   */
  history(open?: boolean): boolean;
};

/**
 * The focus actions: the api plus what the components and the other modules call.
 */
export type FocusActions = FocusApi & {
  /** Selects an edge "<id>:<outcome>" and focuses its source node. */
  selectEdge(edge: string, source: NodeId): void;
  /** Keys of the selected item and its neighbours (dimming); undefined without a selection. */
  related(): ReadonlySet<ItemKey> | undefined;
  /** World rect of the selection and its neighbours, else of the current node. */
  relatedRect(): Rect | undefined;
  /** Where the current node is on the canvas. */
  locateCurrent(): CurrentSpot | undefined;
  /** The runtime stack of the current position, outermost first. */
  stack(): readonly StackEntry[];
  /** Whether the link says the game is paused (Step is enabled only then, M5). */
  isPaused(): boolean;
  /** Moves the Info tab highlight to a row. */
  highlight(side: "from" | "to", index: number): void;
  /** Moves the Info tab highlight up (-1) or down (1): through Outcomes, then Comes from. */
  moveHighlight(delta: 1 | -1): void;
  /** Follows the highlighted Info tab row (Enter); false when no row is highlighted. */
  followHighlight(): boolean;
  /** Returns to the selection before the last followed edge; false when there is none. */
  back(): boolean;
  /** Moves the camera onto the current node with a pulse (C, toolbar, breadcrumb chip). */
  findCurrent(): boolean;
  /** Opens a context menu. */
  openMenu(menu: MenuState): void;
  /** Closes the context menu; false when none was open (Esc layer contextMenu). */
  closeMenu(): boolean;
  /** Leaves focus and empties the Back stack; false when nothing was selected (Esc layer selection). */
  leave(): boolean;
  /** Hovers a history dot. */
  hoverHistory(index?: number): void;
  /** Selects the edge of a history entry and focuses its source node. */
  selectHistory(index: number): void;
  /** Runs game.pause through panels.run; a failure is logged and toasted. */
  pause(): Promise<void>;
  /** Runs game.resume through panels.run; a failure is logged and toasted. */
  resume(): Promise<void>;
};
