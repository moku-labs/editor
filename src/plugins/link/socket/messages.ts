/**
 * @file link plugin — routes what the hub sends: responses settle calls; `editor` notifications
 * (`sessions`, `session`) drive the session choice; `game` notifications of the chosen session
 * (`heartbeat`, `value`) drive the status and the watches (R1).
 */

import type { Message, Notification } from "../../registry/protocol";
import { decode, isRequest, isResponse } from "../../registry/protocol";
import { settle } from "../rpc/calls";
import { flagOf, numberOf, objectOf, readSessions, textOf } from "../rpc/shapes";
import { applySessions, closeChosen } from "../sessions/choose";
import { applyStatus } from "../status/machine";
import { deliver } from "../subscriptions/watch";
import type { LinkCtx } from "../types";

/**
 * The reason of a session close the hub sent without one.
 */
const DEFAULT_CLOSE_REASON = "game_reloaded";

/**
 * Handles one notification.
 */
type Route = (ctx: LinkCtx, note: Notification) => void;

/**
 * `editor` · `sessions { list }`: the new session list.
 *
 * @param ctx - Domain context of link.
 * @param note - The notification.
 * @example
 * ```ts
 * onSessions(ctx, note);
 * ```
 */
function onSessions(ctx: LinkCtx, note: Notification): void {
  const list = readSessions(note.params);

  if (list === undefined) ctx.log.warn("link:bad-sessions", {});
  else applySessions(ctx, list);
}

/**
 * `editor` · `session { id, open, reason? }`: a close of the chosen session loses it; an open is
 * only logged (the `sessions` list that follows attaches it).
 *
 * @param ctx - Domain context of link.
 * @param note - The notification.
 * @example
 * ```ts
 * onSession(ctx, note);
 * ```
 */
function onSession(ctx: LinkCtx, note: Notification): void {
  const params = objectOf(note.params);
  const id = params && textOf(params, "id");
  const open = params && flagOf(params, "open");
  if (params === undefined || id === undefined || open === undefined) return;

  if (open) ctx.log.debug("link:session-open", { id });
  else if (id === ctx.state.chosen) {
    closeChosen(ctx, textOf(params, "reason") ?? DEFAULT_CLOSE_REASON);
  }
}

/**
 * `game` · `heartbeat` of the chosen session: stored with the local arrival time.
 *
 * @param ctx - Domain context of link.
 * @param note - The notification.
 * @example
 * ```ts
 * onHeartbeat(ctx, note);
 * ```
 */
function onHeartbeat(ctx: LinkCtx, note: Notification): void {
  const { state } = ctx;
  const params = objectOf(note.params);
  const frame = params && numberOf(params, "frame");
  const paused = params && flagOf(params, "paused");
  if (note.session !== state.chosen || frame === undefined || paused === undefined) return;

  state.heartbeat = { frame, paused, receivedAt: Date.now() };
  applyStatus(ctx, { type: "heartbeat", frame, paused });
}

/**
 * `game` · `value { sub, value }` of the chosen session: delivered to its watch.
 *
 * @param ctx - Domain context of link.
 * @param note - The notification.
 * @example
 * ```ts
 * onValue(ctx, note);
 * ```
 */
function onValue(ctx: LinkCtx, note: Notification): void {
  const params = objectOf(note.params);
  const sub = params && numberOf(params, "sub");
  const value = params?.value;
  if (note.session !== ctx.state.chosen || sub === undefined || value === undefined) return;

  deliver(ctx, sub, value);
}

/**
 * Handlers by `channel.method`.
 */
const ROUTES: ReadonlyMap<string, Route> = new Map([
  ["editor.sessions", onSessions],
  ["editor.session", onSession],
  ["game.heartbeat", onHeartbeat],
  ["game.value", onValue]
]);

/**
 * Handles one text frame from the hub. An undecodable frame is logged at warn and dropped.
 *
 * @param ctx - Domain context of link.
 * @param text - The frame text.
 * @example
 * ```ts
 * socket.addEventListener("message", event => onSocketMessage(ctx, event.data));
 * ```
 */
export function onSocketMessage(ctx: LinkCtx, text: string): void {
  if (ctx.state.stopped) return;

  let message: Message;
  try {
    message = decode(text);
  } catch (error) {
    ctx.log.warn("link:bad-message", { error: error instanceof Error ? error.message : "" });
    return;
  }

  if (isResponse(message)) {
    settle(ctx, message);
    return;
  }
  if (isRequest(message)) {
    ctx.log.debug("link:unexpected-request", { method: message.method });
    return;
  }

  const route = ROUTES.get(`${message.channel}.${message.method}`);
  if (route === undefined) ctx.log.debug("link:unknown-notification", { method: message.method });
  else route(ctx, message);
}
