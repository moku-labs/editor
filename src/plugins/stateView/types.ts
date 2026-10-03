/**
 * @file stateView plugin — type definitions: config, the model snapshot, derived commit patches,
 * the runner stack, tree rows, state, api, the domain context and the hooks. Commit patches are
 * derived by diffing successive game.model snapshots until game follow-up F-S1 (R4).
 */
import type { Log } from "@moku-labs/common/browser";
import type { Require, ToolsEvents } from "../../config";
import type { Json } from "../registry/protocol";

/**
 * stateView configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { stateView: { expandDepth: 3 } } });
 * ```
 */
export type Config = {
  /** Tree levels open by default under player and session (0 = only the root row). Default 2. */
  expandDepth: number;
  /** Most patches kept per commit; the rest is counted as "+N more". Default 200. */
  maxPatches: number;
  /** Children shown per array or object before a "Show N more" row. Default 100. */
  pageSize: number;
};

/**
 * A root of the model that stateView shows as a tree and diffs: rng is never a tree.
 *
 * @example
 * ```ts
 * const root: StateRoot = "player";
 * ```
 */
export type StateRoot = "player" | "session";

/**
 * game.model as stateView reads it: `app.model.store.snapshot()` over the wire.
 *
 * @example
 * ```ts
 * const snapshot: ModelSnapshot = { player: { merge: { nextItemId: 4 } }, session: { taps: 3 }, rng: { seed: 42 } };
 * ```
 */
export type ModelSnapshot = { readonly player: Json; readonly session: Json; readonly rng?: Json };

/**
 * One derived patch: JSON Patch shape plus the old value.
 *
 * @example
 * ```ts
 * const patch: StatePatch = {
 *   op: "replace", root: "player", path: ["merge", "energy", "value"],
 *   pointer: "/player/merge/energy/value", value: 7, was: 8
 * };
 * ```
 */
export type StatePatch = {
  readonly op: "add" | "remove" | "replace";
  readonly root: StateRoot;
  /** Inside the root, e.g. ["merge", "energy", "value"]. */
  readonly path: readonly (string | number)[];
  /** JSON Pointer incl. root, e.g. "/player/merge/energy/value". */
  readonly pointer: string;
  /** The new value (add, replace). */
  readonly value?: Json;
  /** The old value (remove, replace). */
  readonly was?: Json;
};

/**
 * The last derived commit of the session.
 *
 * @example
 * ```ts
 * app.stateView.lastCommit(); // { seq: 1, frame: 1503, patches: [4 patches], truncated: 0, rngChanged: false, … }
 * ```
 */
export type LastCommit = {
  /** 1, 2, 3 … commits seen in this session. */
  readonly seq: number;
  /** Heartbeat frame when the value arrived (approximate, shown ~fN). */
  readonly frame: number | undefined;
  /** Date.now() on arrival. */
  readonly at: number;
  /** At most maxPatches, in document order. */
  readonly patches: readonly StatePatch[];
  /** Patches not kept. */
  readonly truncated: number;
  /** Pointers of every kept patch. */
  readonly changed: ReadonlySet<string>;
  /** Every proper prefix pointer of `changed` ("/player", "/player/merge"). */
  readonly ancestors: ReadonlySet<string>;
  /** The rng branch differs (one meta line, never patches). */
  readonly rngChanged: boolean;
};

/**
 * Why there is no commit: never connected, connected without a commit yet, reset by a reload.
 *
 * @example
 * ```ts
 * const note: TrackerNote = "waiting";
 * ```
 */
export type TrackerNote = "none" | "waiting" | "reloaded";

/**
 * One frame of the runner stack.
 *
 * @example
 * ```ts
 * const frame: StackFrame = { flow: "board", node: "awaitIntent" };
 * ```
 */
export type StackFrame = { readonly flow: string; readonly node: string };

/**
 * One visible row of a JSON tree: a value row, or the "Show N more" row of a paged container.
 */
export type TreeRow =
  | {
      readonly kind: "node";
      readonly pointer: string;
      /** Pointer of the parent row, undefined for the root row. */
      readonly parent: string | undefined;
      /** The key, the index, or the root name. */
      readonly label: string;
      readonly depth: number;
      readonly value: Json;
      /** Number of children of an object or array, undefined for a leaf. */
      readonly size: number | undefined;
      readonly open: boolean;
    }
  | {
      readonly kind: "more";
      /** `<parent pointer>#more`. */
      readonly pointer: string;
      readonly parent: string;
      readonly depth: number;
      /** Children not shown yet. */
      readonly hidden: number;
    };

/**
 * What treeRows asks about each container.
 */
export type TreeOptions = {
  /** Whether the container row at this pointer and depth is open. */
  readonly isOpen: (pointer: string, depth: number) => boolean;
  /** How many children of the container are shown. */
  readonly shown: (pointer: string) => number;
};

/**
 * What a key on a tree row does: move the focus to a row, or open or close a row.
 */
export type TreeKeyAction =
  | { readonly kind: "focus"; readonly pointer: string }
  | { readonly kind: "open"; readonly pointer: string; readonly open: boolean };

/**
 * stateView state.
 */
export type StateViewState = {
  /** Last snapshot seen; undefined after a reset. */
  baseline: ModelSnapshot | undefined;
  last: LastCommit | undefined;
  note: TrackerNote;
  seq: number;
  /** undefined = unknown (no value yet or source missing). */
  tainted: boolean | undefined;
  /** game.graph, read once per manifest. */
  graph: Json | undefined;
  /** link.session() the baseline belongs to. */
  session: string | undefined;
  /** Pointer → open; overrides expandDepth and survives remounts. */
  expanded: Map<string, boolean>;
  listeners: Set<() => void>;
  /** link.watch("game.model") unsubscribe. */
  stopModel: (() => void) | undefined;
  /** link.watch("game.tainted") unsubscribe. */
  stopTainted: (() => void) | undefined;
  /** link.onManifest unsubscribe. */
  stopManifest: (() => void) | undefined;
};

/**
 * The stateView api (`app.stateView`): the commit tracker and the tree expansion of the State
 * workspace. The view and the tests read it; no other plugin needs it yet.
 *
 * @example
 * ```ts
 * app.stateView.lastCommit()?.patches.length; // 4
 * ```
 */
export type StateViewApi = {
  /**
   * The last commit of the current session, derived by diffing two `game.model` snapshots (R4).
   * The first value after a connect or a reset is a baseline, never a commit; a value equal to
   * the baseline is no commit either.
   *
   * @returns The commit, undefined before the first one of the session.
   * @example
   * ```ts
   * // The player tapped the sawmill; the heartbeat said frame 1503 when the value arrived.
   * app.stateView.lastCommit()?.patches.length; // 4
   * app.stateView.lastCommit()?.frame; // 1503
   * ```
   */
  lastCommit(): LastCommit | undefined;

  /**
   * Why there is no commit: `"none"` (never connected), `"waiting"` (connected, no commit yet),
   * `"reloaded"` (the game page reloaded and reset the tracker).
   *
   * @returns The note.
   * @example
   * ```ts
   * // A game connected and sent its first snapshot; nobody tapped yet.
   * app.stateView.note(); // "waiting"
   * ```
   */
  note(): TrackerNote;

  /**
   * Calls `fn` after every tracker change: a commit, a reset, a taint, the graph, an expansion.
   *
   * @param fn - The listener.
   * @returns The unsubscribe; calling it twice is a no-op.
   * @example
   * ```ts
   * // A test counts the tracker changes of one tap.
   * let changes = 0;
   * const off = app.stateView.onCommit(() => changes++);
   * off(); // later changes are not counted
   * ```
   */
  onCommit(fn: () => void): () => void;

  /**
   * The last known taint of the session, from the `game.tainted` watch (R6) or, at once, from the
   * run envelope of a command run on the tools page.
   *
   * @returns true or false, undefined while unknown.
   * @example
   * ```ts
   * // A fresh session where no cheat ran.
   * app.stateView.tainted(); // false
   * ```
   */
  tainted(): boolean | undefined;

  /**
   * The cached `game.graph` of the current session, read once per manifest; the Runner derives
   * the stack from it.
   *
   * @returns The graph, undefined before it arrived or when the read failed.
   * @example
   * ```ts
   * // After the merge-game session attached.
   * app.stateView.graph(); // { main: "main", flows: { main: …, board: … }, slots: … }
   * ```
   */
  graph(): Json | undefined;

  /**
   * Open state of a tree row: the stored override, else `depth < config.expandDepth`.
   *
   * @param pointer - JSON pointer of the row, e.g. "/player/merge".
   * @param depth - Depth of the row; the root row is 0.
   * @returns Whether the row is open.
   * @example
   * ```ts
   * // Default expandDepth 2: the root and its children are open.
   * app.stateView.expanded("/player/merge", 1); // true
   * app.stateView.expanded("/player/merge/board", 2); // false
   * ```
   */
  expanded(pointer: string, depth: number): boolean;

  /**
   * Stores the open state of one tree row and notifies the listeners.
   *
   * @param pointer - JSON pointer of the row.
   * @param open - true to open, false to close.
   * @example
   * ```ts
   * // The developer folds the board away.
   * app.stateView.setExpanded("/player/merge/board", false);
   * app.stateView.expanded("/player/merge/board", 2); // false
   * ```
   */
  setExpanded(pointer: string, open: boolean): void;

  /**
   * Opens or closes every object and array row under a root of the current baseline (Expand all
   * / Collapse all) and notifies the listeners.
   *
   * @param root - "player" or "session".
   * @param open - true for Expand all, false for Collapse all.
   * @example
   * ```ts
   * // Expand all on the Player card.
   * app.stateView.expandAll("player", true);
   * app.stateView.expanded("/player/merge/generators/sawmill", 3); // true
   * ```
   */
  expandAll(root: StateRoot, open: boolean): void;
};

/**
 * Domain context of stateView: the kernel context is assignable to it.
 */
export type StateViewCtx = {
  readonly config: Readonly<Config>;
  state: StateViewState;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * stateView's hooks (global tools events, R4).
 */
export type StateViewHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
  readonly "workspace:ran": (payload: ToolsEvents["workspace:ran"]) => void;
};
