/**
 * @file link plugin — watch records (kept while disconnected, R4) and their numeric wire subs
 * (R6: taken from `nextSub`, never reused, so a late value of an old sub is dropped).
 */
import type { Json, SubId } from "../../registry/protocol";
import { describeError, request } from "../rpc/calls";
import { isAttached } from "../state";
import type { LinkCtx, Subscription } from "../types";

/**
 * True when watches can be sent now: the chosen session is attached and its manifest is in.
 *
 * @param ctx - Domain context of link.
 * @returns Whether a new watch goes out at once.
 */
function isReady(ctx: LinkCtx): boolean {
  const { state } = ctx;
  return isAttached(state) && state.chosen !== undefined && state.manifests.has(state.chosen);
}

/**
 * Sends `unwatch { sub }`; the answer is ignored, a failure is logged at debug.
 *
 * @param ctx - Domain context of link.
 * @param sub - The wire sub.
 * @param session - The session it was sent to.
 */
function sendUnwatch(ctx: LinkCtx, sub: SubId, session: string | undefined): void {
  request(ctx, "game", "unwatch", { sub }, session).catch((error: unknown) => {
    ctx.log.debug("link:unwatch-failed", { sub, ...describeError(error) });
  });
}

/**
 * Sends `watch { sub, id, input? }` with a new wire sub. An error answer is logged as
 * `link:watch-failed`; the record stays and is sent again on the next attach. A watch the link
 * itself closed on stop (`link_closed`) is not logged.
 *
 * @param ctx - Domain context of link.
 * @param sub - The record.
 */
function sendWatch(ctx: LinkCtx, sub: Subscription): void {
  const { state } = ctx;
  const wireSub = state.nextSub;

  state.nextSub += 1;
  sub.wireSub = wireSub;
  state.wire.set(wireSub, sub);

  const params: Json =
    sub.input === undefined
      ? { sub: wireSub, id: sub.id }
      : { sub: wireSub, id: sub.id, input: sub.input };
  request(ctx, "game", "watch", params, state.chosen).catch((error: unknown) => {
    if (!state.stopped) ctx.log.error("link:watch-failed", { id: sub.id, ...describeError(error) });
    if (state.wire.get(wireSub) !== sub) return;
    state.wire.delete(wireSub);
    sub.wireSub = undefined;
  });
}

/**
 * Records a watch; sends it now when attached, otherwise on the next attach.
 *
 * @param ctx - Domain context of link.
 * @param id - Source id.
 * @param input - Source input, omitted on the wire when undefined.
 * @param onValue - Called with every value (the agent's immediate read first).
 * @returns Unsubscribe: forgets the record and sends `unwatch` when attached; twice is a no-op.
 */
export function addWatch(
  ctx: LinkCtx,
  id: string,
  input: Json | undefined,
  onValue: (value: Json) => void
): () => void {
  const { state } = ctx;
  const sub: Subscription = { key: state.nextKey, id, input, onValue, wireSub: undefined };

  state.nextKey += 1;
  state.subs.set(sub.key, sub);
  if (isReady(ctx)) sendWatch(ctx, sub);

  return () => {
    if (!state.subs.delete(sub.key)) return;

    const { wireSub } = sub;
    if (wireSub === undefined) return;
    state.wire.delete(wireSub);
    sub.wireSub = undefined;
    if (isAttached(state)) sendUnwatch(ctx, wireSub, state.chosen);
  };
}

/**
 * Sends every record to the chosen session with a new wire sub. A source the manifest does not
 * list is skipped with `link:source-missing` (the record stays for a later session). A record that
 * already has a wire sub was sent in this attach (a manifest listener added it) and is skipped;
 * attach clears every wire sub first, so each record goes out once per attach.
 *
 * @param ctx - Domain context of link.
 */
export function resubscribeAll(ctx: LinkCtx): void {
  const { state } = ctx;
  const manifest = state.chosen === undefined ? undefined : state.manifests.get(state.chosen);
  const known = new Set(manifest?.sources.map(source => source.id));

  for (const sub of state.subs.values()) {
    if (!known.has(sub.id)) ctx.log.warn("link:source-missing", { id: sub.id });
    else if (sub.wireSub === undefined) sendWatch(ctx, sub);
  }
}

/**
 * Sends `unwatch` for every wire sub of the current attach (a voluntary switch).
 *
 * @param ctx - Domain context of link.
 * @param session - The session the subs were sent to.
 */
export function unwatchAll(ctx: LinkCtx, session: string): void {
  for (const wireSub of ctx.state.wire.keys()) sendUnwatch(ctx, wireSub, session);
}

/**
 * Forgets every wire sub; the records stay for the next attach.
 *
 * @param ctx - Domain context of link.
 */
export function detachAll(ctx: LinkCtx): void {
  const { wire } = ctx.state;

  for (const sub of wire.values()) sub.wireSub = undefined;
  wire.clear();
}

/**
 * Delivers a value to the watch of a wire sub; an unknown sub (an older attach) is dropped, a
 * throwing `onValue` is logged.
 *
 * @param ctx - Domain context of link.
 * @param sub - The wire sub.
 * @param value - The value.
 */
export function deliver(ctx: LinkCtx, sub: SubId, value: Json): void {
  const record = ctx.state.wire.get(sub);
  if (record === undefined) return;

  try {
    record.onValue(value);
  } catch (error) {
    ctx.log.error(
      "link:on-value-failed",
      { id: record.id },
      error instanceof Error ? error : undefined
    );
  }
}
