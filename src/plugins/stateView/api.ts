/**
 * @file stateView plugin — api factory: binds the tracker readers and the tree expansion to the
 * plugin context. The contract and the examples live on `StateViewApi` in types.ts.
 */
import type { Json } from "../registry/protocol";
import { notify } from "./tracker";
import { containerPointers } from "./tree";
import type { LastCommit, StateRoot, StateViewApi, StateViewCtx, TrackerNote } from "./types";

/**
 * The last derived commit.
 *
 * @param ctx - Domain context of stateView.
 * @returns The commit, or undefined.
 * @example
 * ```ts
 * readLastCommit(ctx)?.seq; // 1 after the first commit of the session
 * ```
 */
function readLastCommit(ctx: StateViewCtx): LastCommit | undefined {
  return ctx.state.last;
}

/**
 * Why there is no commit.
 *
 * @param ctx - Domain context of stateView.
 * @returns The note.
 * @example
 * ```ts
 * readNote(ctx); // "none" before any game connected
 * ```
 */
function readNote(ctx: StateViewCtx): TrackerNote {
  return ctx.state.note;
}

/**
 * Adds a tracker listener.
 *
 * @param ctx - Domain context of stateView.
 * @param fn - The listener.
 * @returns The idempotent remover.
 * @example
 * ```ts
 * const off = subscribe(ctx, () => redraw()); // off() removes it
 * ```
 */
function subscribe(ctx: StateViewCtx, fn: () => void): () => void {
  ctx.state.listeners.add(fn);
  return () => {
    ctx.state.listeners.delete(fn);
  };
}

/**
 * The last known taint.
 *
 * @param ctx - Domain context of stateView.
 * @returns true, false or undefined.
 * @example
 * ```ts
 * readTainted(ctx); // undefined until game.tainted delivered
 * ```
 */
function readTainted(ctx: StateViewCtx): boolean | undefined {
  return ctx.state.tainted;
}

/**
 * The cached game.graph.
 *
 * @param ctx - Domain context of stateView.
 * @returns The graph, or undefined.
 * @example
 * ```ts
 * readGraph(ctx); // undefined until the manifest of a session arrived
 * ```
 */
function readGraph(ctx: StateViewCtx): Json | undefined {
  return ctx.state.graph;
}

/**
 * Open state of a tree row: the override, else depth below expandDepth.
 *
 * @param ctx - Domain context of stateView.
 * @param pointer - The row pointer.
 * @param depth - The row depth.
 * @returns Whether it is open.
 * @example
 * ```ts
 * isExpanded(ctx, "/player/merge", 1); // true with expandDepth 2
 * ```
 */
function isExpanded(ctx: StateViewCtx, pointer: string, depth: number): boolean {
  return ctx.state.expanded.get(pointer) ?? depth < ctx.config.expandDepth;
}

/**
 * Stores the open state of a row and notifies.
 *
 * @param ctx - Domain context of stateView.
 * @param pointer - The row pointer.
 * @param open - The open state.
 * @example
 * ```ts
 * setExpanded(ctx, "/player/merge/board", false);
 * ```
 */
function setExpanded(ctx: StateViewCtx, pointer: string, open: boolean): void {
  ctx.state.expanded.set(pointer, open);
  notify(ctx.state);
}

/**
 * Sets every container pointer under a root of the baseline and notifies.
 *
 * @param ctx - Domain context of stateView.
 * @param root - "player" or "session".
 * @param open - The open state.
 * @example
 * ```ts
 * expandAll(ctx, "player", true);
 * ```
 */
function expandAll(ctx: StateViewCtx, root: StateRoot, open: boolean): void {
  const { baseline, expanded } = ctx.state;
  if (baseline !== undefined) {
    for (const pointer of containerPointers(baseline[root], root)) expanded.set(pointer, open);
  }
  notify(ctx.state);
}

/**
 * Creates the stateView api.
 *
 * @param ctx - Domain context of stateView.
 * @returns The StateViewApi (`app.stateView`).
 * @example
 * ```ts
 * createToolsPlugin("stateView", { api: createStateViewApi });
 * ```
 */
export function createStateViewApi(ctx: StateViewCtx): StateViewApi {
  return {
    lastCommit: readLastCommit.bind(undefined, ctx),
    note: readNote.bind(undefined, ctx),
    onCommit: subscribe.bind(undefined, ctx),
    tainted: readTainted.bind(undefined, ctx),
    graph: readGraph.bind(undefined, ctx),
    expanded: isExpanded.bind(undefined, ctx),
    setExpanded: setExpanded.bind(undefined, ctx),
    expandAll: expandAll.bind(undefined, ctx)
  };
}
