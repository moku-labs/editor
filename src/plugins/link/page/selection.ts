/**
 * @file link plugin — the selection of the editor page (D-33). `notify("selection", …)` sends it to
 * the hub on the editor channel; a value is dropped while the socket is closed and the last one is
 * sent again on every socket open. The hub's `editor.selection` notification keeps `selection()`
 * readable (this page's own publish echoed back, or another editor page tab's) and reaches the
 * onPublished listeners of `selection`. The wire refuses null params, so "nothing selected" is a
 * `selection` notification without params, both ways.
 */
import type { Json, PublishParams, SelectionInfo } from "../../registry/protocol";
import { encode, notification, parseSelectionInfo, toWireValue } from "../../registry/protocol";
import { freezeDeep, isSameValue, notifyPublished } from "../server/published";
import type { LinkCtx, LinkState, NotifyMethod } from "../types";

/**
 * Sends one editor-channel notification when the socket is open; null goes out without params. A
 * failed send is a warning.
 *
 * @param ctx - Domain context of link.
 * @param method - The notification method.
 * @param value - Its wire value.
 */
function send(ctx: LinkCtx, method: NotifyMethod, value: Json): void {
  const { state } = ctx;
  const { socket } = state;
  if (!state.open || socket === undefined) return;

  try {
    socket.send(encode(notification("editor", method, value ?? undefined)));
  } catch {
    ctx.log.warn("link:notify-failed", { method });
  }
}

/**
 * Keeps the value as the last one of its method and sends it now when the socket is open. A no-op
 * after stop.
 *
 * @param ctx - Domain context of link.
 * @param method - "selection".
 * @param params - The selection, or null when nothing is selected.
 */
export function notifyEditor(
  ctx: LinkCtx,
  method: NotifyMethod,
  params: PublishParams["selection"]
): void {
  if (ctx.state.stopped) return;

  const value = toWireValue(params);
  ctx.state.notified.set(method, value);
  send(ctx, method, value);
}

/**
 * Sends the last value of every notified method again; called when a socket opens.
 *
 * @param ctx - Domain context of link.
 */
export function resendNotified(ctx: LinkCtx): void {
  for (const [method, value] of ctx.state.notified) send(ctx, method, value);
}

/**
 * Clears the held selection; the listeners get null once, when there was one.
 *
 * @param ctx - Domain context of link.
 */
function clearSelection(ctx: LinkCtx): void {
  if (ctx.state.selection === undefined) return;

  ctx.state.selection = undefined;
  // eslint-disable-next-line unicorn/no-null -- null is the wire's "nothing selected"
  notifyPublished(ctx, "selection", null);
}

/**
 * Handles the params of the hub's `editor.selection` notification: none (or null) clears the
 * selection, a SelectionInfo replaces it (frozen), anything else is the warning
 * `link:bad-selection` and changes nothing. A change goes to the onPublished listeners of
 * `selection`; the replay of an equal selection, or of nothing selected, goes to nobody.
 *
 * @param ctx - Domain context of link.
 * @param params - The notification params.
 */
export function onSelectionNote(ctx: LinkCtx, params: Json | undefined): void {
  if (params === undefined || params === null) {
    clearSelection(ctx);
    return;
  }

  const info = parseSelectionInfo(params);
  if (info === undefined) {
    ctx.log.warn("link:bad-selection", {});
    return;
  }
  const held = ctx.state.selection;
  if (held !== undefined && isSameValue(held, info)) return;

  const frozen = freezeDeep(info);
  ctx.state.selection = frozen;
  notifyPublished(ctx, "selection", frozen);
}

/**
 * The selection the hub last sent, as a fresh copy.
 *
 * @param state - Link state.
 * @returns The copy, or undefined when nothing is selected.
 */
export function currentSelection(state: LinkState): SelectionInfo | undefined {
  return state.selection === undefined ? undefined : parseSelectionInfo(state.selection);
}
