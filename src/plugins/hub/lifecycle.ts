/**
 * @file hub plugin — onStart (new token, silent interval) and onStop (clear timers, close every
 * socket with 1001, forget sessions, no selection, token undefined). The Bun server itself belongs
 * to the game.
 */
import { tickSilent } from "./routing/sessions";
import { newToken } from "./security/token";
import { JSON_NULL } from "./sockets/send";
import type { HubCtx, HubState } from "./types";

/**
 * The longest gap between two silent checks, in ms.
 */
const MAX_TICK_MS = 1000;

/**
 * Close code and reason of every socket on stop.
 */
const GOING_AWAY = 1001;

/**
 * Lets the process exit while the timer runs (Bun and Node timers have unref).
 *
 * @param timer - The interval handle.
 * @example
 * ```ts
 * unref(setInterval(tick, 1000));
 * ```
 */
function unref(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

/**
 * onStart: a new token per start (never logged) and the silent interval (unref'd), ticking every
 * min(1000, silentAfterMs / 2) ms.
 *
 * @param ctx - Domain context of the hub.
 */
export function startHub(ctx: HubCtx): void {
  const { state, config } = ctx;
  state.token = newToken();

  if (state.silentTimer !== undefined) clearInterval(state.silentTimer);
  const every = Math.min(MAX_TICK_MS, config.silentAfterMs / 2);
  state.silentTimer = setInterval(() => tickSilent(ctx, Date.now()), every);
  unref(state.silentTimer);
  ctx.log.info("hub:started", { path: config.path });
}

/**
 * onStop: clears the timers, forgets every connection, session, call and watch, then closes every
 * socket with 1001 "editor stopping" (the maps are cleared first, so the close handler finds
 * nothing to announce). No editor page is left, so a kept selection becomes `null` (A7). Later
 * upgrades get 503.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopHub(ctx: { readonly state: HubState }): void {
  const { state } = ctx;
  if (state.silentTimer !== undefined) clearInterval(state.silentTimer);
  state.silentTimer = undefined;
  for (const call of state.pending.values()) clearTimeout(call.timer);

  const sockets = [...state.conns.values()].map(conn => conn.socket);
  state.conns.clear();
  state.sessions.clear();
  state.pending.clear();
  state.shared.clear();
  state.token = undefined;
  state.selectionConn = undefined;
  if (state.published.has("selection")) state.published.set("selection", JSON_NULL);

  for (const socket of sockets) socket.close(GOING_AWAY, "editor stopping");
}
