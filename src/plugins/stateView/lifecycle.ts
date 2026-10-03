/**
 * @file stateView plugin — onInit (register the State panel), onStart (manifest listener, the
 * game.model and game.tainted watches for the whole session) and onStop (drop them).
 */
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { createStatePanel } from "./panel";
import { acceptManifest, acceptModel, acceptTainted } from "./tracker";
import type { StateViewCtx, StateViewState } from "./types";

/**
 * onInit: registers the State panel, so the host knows every workspace before it mounts (D-04).
 *
 * @param ctx - Domain context of stateView.
 * @example
 * ```ts
 * createToolsPlugin("stateView", { onInit: registerStatePanel });
 * ```
 */
export function registerStatePanel(ctx: StateViewCtx): void {
  ctx.require(panelsPlugin).register(createStatePanel(ctx));
}

/**
 * onStart: the manifest listener, then the game.model and game.tainted watches (R6). The link
 * accepts watches while disconnected and re-sends them after a reconnect or a session change, so
 * they live for the whole app, across workspace switches.
 *
 * @param ctx - Domain context of stateView.
 * @example
 * ```ts
 * createToolsPlugin("stateView", { onStart: startStateView });
 * ```
 */
export function startStateView(ctx: StateViewCtx): void {
  const link = ctx.require(linkPlugin);
  const { state } = ctx;
  state.stopManifest = link.onManifest(manifest => acceptManifest(ctx, manifest));
  // follow-up: game.commit (F-S1) — watch it here instead of diffing game.model once the game ships it.
  state.stopModel = link.watch("game.model", undefined, value => acceptModel(ctx, value));
  state.stopTainted = link.watch("game.tainted", undefined, value => acceptTainted(ctx, value));
}

/**
 * onStop: drops both watches and the manifest listener and clears the UI listeners. Uses only
 * the teardown context, so every unsubscriber lives in state.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("stateView", { onStop: stopStateView });
 * ```
 */
export function stopStateView(ctx: { readonly state: StateViewState }): void {
  const { state } = ctx;
  state.stopModel?.();
  state.stopTainted?.();
  state.stopManifest?.();
  state.stopModel = undefined;
  state.stopTainted = undefined;
  state.stopManifest = undefined;
  state.listeners.clear();
}
