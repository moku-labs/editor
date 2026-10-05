/**
 * @file link plugin — onStart (read the boot tag, open the socket, start the silence watch) and
 * onStop (close the socket, clear every timer, reject pending calls with link_closed).
 */
import { ERROR_PREFIX } from "../registry/protocol";
import { failAll, linkClosedError } from "./rpc/calls";
import { settleWaiters } from "./server/hot-reload";
import { connect } from "./socket/connect";
import { clearReload, clearRetry } from "./state";
import { startSilenceWatch } from "./status/silence";
import type { Config, LinkCtx, LinkState } from "./types";

/**
 * Close code of a normal stop.
 */
const NORMAL_CLOSE = 1000;

/**
 * onInit: validates the config.
 *
 * @param ctx - Context with the resolved config.
 * @param ctx.config - Resolved plugin config.
 * @throws {Error} `[moku-editor] link.reloadGraceMs is invalid.` unless it is a positive number.
 */
export function checkLinkConfig(ctx: { readonly config: Readonly<Config> }): void {
  const { reloadGraceMs } = ctx.config;
  if (Number.isFinite(reloadGraceMs) && reloadGraceMs > 0) return;
  throw new Error(
    `${ERROR_PREFIX}link.reloadGraceMs is invalid.\n  Use a positive number of milliseconds.`
  );
}

/**
 * onStart: starts the silence interval, reads `#moku-editor-boot` and opens the websocket. Does
 * not await the socket, so `app.start()` resolves with status `connecting` (or lost `no_boot`).
 *
 * @param ctx - Domain context of link.
 */
export function startLink(ctx: LinkCtx): void {
  startSilenceWatch(ctx);
  connect(ctx);
}

/**
 * onStop: stopped = true (every socket callback returns early from now on), clears the retry and
 * silence timers and the expected reload window, rejects pending calls with `link_closed`, answers waiting `setHotReload` calls
 * false, closes the socket with 1000 and forgets the watches, the manifest, tap and hot reload
 * listeners, the notified values and the request handlers.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopLink(ctx: { readonly state: LinkState }): void {
  const { state } = ctx;
  const { socket } = state;

  state.stopped = true;
  clearRetry(state);
  clearReload(state);
  clearInterval(state.silenceTimer);
  state.silenceTimer = undefined;
  failAll(ctx, linkClosedError());
  settleWaiters(state);

  state.socket = undefined;
  state.open = false;
  socket?.close(NORMAL_CLOSE, "stop");

  state.subs.clear();
  state.wire.clear();
  state.manifestListeners.clear();
  state.tapListeners.clear();
  state.hotReloadListeners.clear();
  state.notified.clear();
  state.handlers.clear();
}
