/**
 * @file stateView plugin — the commit tracker: keeps the last game.model snapshot of the session
 * as a baseline and diffs every new one against it (R4), stores the watched taint (R6), caches
 * game.graph once per manifest and fans every change out to the listeners. It lives in the
 * plugin, not in the panel, so a commit made while another workspace is shown is still the last
 * commit when the user comes back.
 */
import { linkPlugin } from "../link";
import type { Json, Manifest } from "../registry/protocol";
import { ancestorsOf, diffModel } from "./diff";
import { frameOf, isModelSnapshot } from "./model";
import type { StateViewCtx, StateViewState } from "./types";

/**
 * Calls every listener; a listener may unsubscribe while called.
 *
 * @param state - stateView state.
 * @example
 * ```ts
 * notify(createStateViewState()); // no listener, nothing happens
 * ```
 */
export function notify(state: StateViewState): void {
  for (const listener of state.listeners) listener();
}

/**
 * Forgets the baseline, the commit and the taint, sets the note and notifies. Called on a new
 * session ("waiting") and on a lost link ("reloaded").
 *
 * @param ctx - Domain context of stateView.
 * @param reason - The note to show until the next commit.
 * @example
 * ```ts
 * resetTracker(ctx, "reloaded"); // ctx.state.note === "reloaded", lastCommit() undefined
 * ```
 */
export function resetTracker(ctx: StateViewCtx, reason: "waiting" | "reloaded"): void {
  const { state } = ctx;
  state.baseline = undefined;
  state.last = undefined;
  state.note = reason;
  state.tainted = undefined;
  notify(state);
}

/**
 * Takes one game.model value: the first value of a session is the baseline; a later one that
 * differs becomes the last commit (frame from the link status at arrival, approximate); an equal
 * one (a resubscribe re-sends the snapshot) only moves the baseline. A value of another session
 * resets the baseline silently first.
 *
 * @param ctx - Domain context of stateView.
 * @param value - The watched value.
 * @example
 * ```ts
 * acceptModel(ctx, { player, session, rng }); // second value: ctx.state.last.seq === 1
 * ```
 */
export function acceptModel(ctx: StateViewCtx, value: Json): void {
  if (!isModelSnapshot(value)) {
    ctx.log.warn("stateView:unexpected-model", { type: typeof value });
    return;
  }
  const { state, config } = ctx;
  const link = ctx.require(linkPlugin);
  const session = link.session();
  if (state.session !== session) {
    state.baseline = undefined;
    state.last = undefined;
    state.note = "waiting";
    state.session = session;
  }

  const baseline = state.baseline;
  state.baseline = value;
  if (baseline === undefined) {
    if (state.last === undefined) state.note = "waiting";
    notify(state);
    return;
  }

  const { patches, truncated, rngChanged } = diffModel(baseline, value, config.maxPatches);
  if (patches.length === 0 && truncated === 0 && !rngChanged) return;

  state.seq += 1;
  state.last = {
    seq: state.seq,
    frame: frameOf(link.status()),
    at: Date.now(),
    patches,
    truncated,
    changed: new Set(patches.map(patch => patch.pointer)),
    ancestors: ancestorsOf(patches),
    rngChanged
  };
  notify(state);
}

/**
 * Takes one game.tainted value: a boolean is stored (notify only on a change); anything else is
 * logged and the value left.
 *
 * @param ctx - Domain context of stateView.
 * @param value - The watched value.
 * @example
 * ```ts
 * acceptTainted(ctx, true); // ctx.state.tainted === true
 * ```
 */
export function acceptTainted(ctx: StateViewCtx, value: Json): void {
  if (typeof value !== "boolean") {
    ctx.log.warn("stateView:unexpected-tainted", { type: typeof value });
    return;
  }
  if (ctx.state.tainted === value) return;
  ctx.state.tainted = value;
  notify(ctx.state);
}

/**
 * Reads game.graph once for the current session. A failed read logs debug and leaves the graph
 * undefined (the Runner then shows the raw path); an answer for an older session is dropped.
 *
 * @param ctx - Domain context of stateView.
 * @returns Resolves when the read settled.
 * @example
 * ```ts
 * await loadGraph(ctx); // ctx.state.graph is the merge-game graph
 * ```
 */
export async function loadGraph(ctx: StateViewCtx): Promise<void> {
  const { state } = ctx;
  const session = state.session;
  state.graph = undefined;
  try {
    const graph = await ctx.require(linkPlugin).read("game.graph");
    if (state.session !== session) return;
    state.graph = graph;
    notify(state);
  } catch (error) {
    ctx.log.debug("stateView:graph-unavailable", {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Takes one manifest of the link: undefined does nothing (the lost hook resets); a manifest of
 * another session resets the tracker ("waiting") and adopts the session; every manifest reloads
 * the graph.
 *
 * @param ctx - Domain context of stateView.
 * @param manifest - The manifest of the chosen session, undefined when it is lost.
 * @example
 * ```ts
 * acceptManifest(ctx, manifest); // new session: ctx.state.note === "waiting"
 * ```
 */
export function acceptManifest(ctx: StateViewCtx, manifest: Manifest | undefined): void {
  if (manifest === undefined) return;
  const session = ctx.require(linkPlugin).session();
  if (session !== ctx.state.session) {
    resetTracker(ctx, "waiting");
    ctx.state.session = session;
  }
  void loadGraph(ctx);
}
