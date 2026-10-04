/**
 * @file link plugin — onStart (read the boot tag, open the socket, start the silence watch) and
 * onStop (close the socket, clear every timer, reject pending calls with link_closed).
 */
import { failAll, linkClosedError } from "./rpc/calls";
import { connect } from "./socket/connect";
import { clearRetry } from "./state";
import { startSilenceWatch } from "./status/silence";
import type { LinkCtx, LinkState } from "./types";

/**
 * Close code of a normal stop.
 */
const NORMAL_CLOSE = 1000;

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
 * silence timers, rejects pending calls with `link_closed`, closes the socket with 1000 and
 * forgets the watches, the manifest, tap and hot reload listeners.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopLink(ctx: { readonly state: LinkState }): void {
  const { state } = ctx;
  const { socket } = state;

  state.stopped = true;
  clearRetry(state);
  clearInterval(state.silenceTimer);
  state.silenceTimer = undefined;
  failAll(ctx, linkClosedError());

  state.socket = undefined;
  state.open = false;
  socket?.close(NORMAL_CLOSE, "stop");

  state.subs.clear();
  state.wire.clear();
  state.manifestListeners.clear();
  state.tapListeners.clear();
  state.hotReloadListeners.clear();
}
