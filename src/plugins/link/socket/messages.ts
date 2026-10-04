/**
 * @file link plugin — routes what the hub sends: responses settle calls; `editor` notifications
 * (`sessions`, `session`) drive the session choice, `hotReload` the hot reload state; `game` notifications of the chosen session
 * (`heartbeat`, `value`, `tap`) drive the status, the heap, the watches and the tap listeners (R1).
 */

import type { Json, Message, Notification } from "../../registry/protocol";
import { decode, isRequest, isResponse } from "../../registry/protocol";
import { settle } from "../rpc/calls";
import { flagOf, numberOf, objectOf, readSessions, textOf } from "../rpc/shapes";
import { onHotReloadNote } from "../server/hot-reload";
import { applySessions, closeChosen } from "../sessions/choose";
import { applyStatus } from "../status/machine";
import { notifyTap } from "../subscriptions/taps";
import { deliver } from "../subscriptions/watch";
import type { LinkCtx, LinkState } from "../types";

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
 * `editor` · `hotReload { hmr, owner }`: the hot reload state of the game server (R6).
 *
 * @param ctx - Domain context of link.
 * @param note - The notification.
 */
function onHotReload(ctx: LinkCtx, note: Notification): void {
  onHotReloadNote(ctx, note.params);
}

/**
 * The `heap` of a heartbeat: finite `usedMb` and `limitMb`.
 *
 * @param value - The `heap` member.
 * @returns A frozen heap, or undefined when absent or malformed.
 * @example
 * ```ts
 * heapOf({ usedMb: 12.8, limitMb: 4095.8 }); // { usedMb: 12.8, limitMb: 4095.8 }
 * heapOf({ usedMb: 12.8 }); // undefined
 * ```
 */
function heapOf(value: Json | undefined): NonNullable<LinkState["heartbeat"]>["heap"] {
  const heap = objectOf(value);
  const usedMb = heap && numberOf(heap, "usedMb");
  const limitMb = heap && numberOf(heap, "limitMb");
  if (usedMb === undefined || limitMb === undefined) return undefined;

  return Object.freeze({ usedMb, limitMb });
}

/**
 * `game` · `heartbeat` of the chosen session: stored with the local arrival time and its heap
 * (a beat without a well-formed heap clears it).
 *
 * @param ctx - Domain context of link.
 * @param note - The notification.
 */
function onHeartbeat(ctx: LinkCtx, note: Notification): void {
  const { state } = ctx;
  const params = objectOf(note.params);
  const frame = params && numberOf(params, "frame");
  const paused = params && flagOf(params, "paused");
  if (note.session !== state.chosen || frame === undefined || paused === undefined) return;

  const receivedAt = Date.now();
  const heap = heapOf(params?.heap);
  state.heartbeat =
    heap === undefined ? { frame, paused, receivedAt } : { frame, paused, receivedAt, heap };
  applyStatus(ctx, { type: "heartbeat", frame, paused });
}

/**
 * `game` · `value { sub, value }` of the chosen session: delivered to its watch.
 *
 * @param ctx - Domain context of link.
 * @param note - The notification.
 */
function onValue(ctx: LinkCtx, note: Notification): void {
  const params = objectOf(note.params);
  const sub = params && numberOf(params, "sub");
  const value = params?.value;
  if (note.session !== ctx.state.chosen || sub === undefined || value === undefined) return;

  deliver(ctx, sub, value);
}

/**
 * `game` · `tap { x, y, at }` of the chosen session: given to the tap listeners.
 *
 * @param ctx - Domain context of link.
 * @param note - The notification.
 */
function onTap(ctx: LinkCtx, note: Notification): void {
  const params = objectOf(note.params);
  const x = params && numberOf(params, "x");
  const y = params && numberOf(params, "y");
  const at = params && numberOf(params, "at");
  const isTap = x !== undefined && y !== undefined && at !== undefined;
  if (note.session !== ctx.state.chosen || !isTap) return;

  notifyTap(ctx, { x, y, at });
}

/**
 * Handlers by `channel.method`.
 */
const ROUTES: ReadonlyMap<string, Route> = new Map([
  ["editor.sessions", onSessions],
  ["editor.session", onSession],
  ["editor.hotReload", onHotReload],
  ["game.heartbeat", onHeartbeat],
  ["game.value", onValue],
  ["game.tap", onTap]
]);

/**
 * Handles one text frame from the hub. An undecodable frame is logged at warn and dropped.
 *
 * @param ctx - Domain context of link.
 * @param text - The frame text.
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
