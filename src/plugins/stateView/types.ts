/**
 * @file stateView plugin — type definitions: config, the model snapshot, derived commit patches,
 * the runner stack, state, api, the domain context and the hooks. Commit patches are derived by
 * diffing successive game.model snapshots until game follow-up F-S1 (R4).
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
  /** Tree levels open by default under player and session. */
  expandDepth: number;
  /** Most patches kept per commit; the rest is counted as "+N more". */
  maxPatches: number;
  /** Children shown per array or object before a "Show N more" row. */
  pageSize: number;
};

/**
 * game.model as stateView reads it.
 */
export type ModelSnapshot = { readonly player: Json; readonly session: Json; readonly rng?: Json };

/**
 * One derived patch (JSON Patch shape plus the old value).
 */
export type StatePatch = {
  readonly op: "add" | "remove" | "replace";
  readonly root: "player" | "session";
  /** Inside the root, e.g. ["merge", "energy", "value"]. */
  readonly path: readonly (string | number)[];
  /** JSON Pointer incl. root, e.g. "/player/merge/energy/value". */
  readonly pointer: string;
  readonly value?: Json;
  readonly was?: Json;
};

/**
 * The last derived commit.
 */
export type LastCommit = {
  readonly seq: number;
  /** Heartbeat frame when the value arrived (approximate, shown ~fN). */
  readonly frame: number | undefined;
  readonly at: number;
  readonly patches: readonly StatePatch[];
  readonly truncated: number;
  readonly changed: ReadonlySet<string>;
  readonly ancestors: ReadonlySet<string>;
  readonly rngChanged: boolean;
};

/**
 * Why there is no commit yet.
 */
export type TrackerNote = "none" | "waiting" | "reloaded";

/**
 * One frame of the runner stack.
 */
export type StackFrame = { readonly flow: string; readonly node: string };

/**
 * stateView state.
 */
export type StateViewState = {
  baseline: ModelSnapshot | undefined;
  last: LastCommit | undefined;
  note: TrackerNote;
  seq: number;
  /** undefined = unknown. */
  tainted: boolean | undefined;
  graph: Json | undefined;
  session: string | undefined;
  /** Pointer → open; survives remounts. */
  expanded: Map<string, boolean>;
  listeners: Set<() => void>;
  stopModel: (() => void) | undefined;
  stopTainted: (() => void) | undefined;
  stopManifest: (() => void) | undefined;
};

/**
 * The stateView api (`app.stateView`).
 *
 * @example
 * ```ts
 * app.stateView.lastCommit()?.patches.length; // 4
 * ```
 */
export type StateViewApi = {
  lastCommit(): LastCommit | undefined;
  note(): TrackerNote;
  onCommit(fn: () => void): () => void;
  tainted(): boolean | undefined;
  graph(): Json | undefined;
  expanded(pointer: string, depth: number): boolean;
  setExpanded(pointer: string, open: boolean): void;
  expandAll(root: "player" | "session", open: boolean): void;
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
