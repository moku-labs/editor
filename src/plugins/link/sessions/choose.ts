/**
 * @file link plugin — the session choice (R7: sticky choice, then embedded first, then newest by
 * `connectedAt`), attach (manifest + resubscribe), session loss and the session retry.
 */

import type { Manifest, SessionInfo } from "../../registry/protocol";
import { errorCode, wireError } from "../../registry/protocol";
import { describeError, request } from "../rpc/calls";
import { expectShape, readManifest } from "../rpc/shapes";
import { backoffDelay } from "../socket/backoff";
import { clearRetry, isAttached } from "../state";
import { applyStatus, emitStatus } from "../status/machine";
import { detachAll, resubscribeAll, unwatchAll } from "../subscriptions/watch";
import type { LinkCtx } from "../types";
import { EMPTY_AFTER_LOST_MS } from "../types";
import { notifyManifest } from "./manifest";

/**
 * The session with the largest `connectedAt` (the first of equals).
 *
 * @param list - Sessions.
 * @returns The newest, or undefined for none.
 * @example
 * ```ts
 * newest(sessions)?.id;
 * ```
 */
function newest(list: readonly SessionInfo[]): SessionInfo | undefined {
  let best: SessionInfo | undefined;
  for (const session of list) {
    if (best === undefined || session.connectedAt > best.connectedAt) best = session;
  }
  return best;
}

/**
 * Picks the session to attach (pure): the sticky current one, else the newest embedded one, else
 * the current one, else the newest.
 *
 * @param list - The open sessions.
 * @param current - The chosen session.
 * @param sticky - Whether `current` was chosen through `choose()`.
 * @returns The session id, or undefined for an empty list.
 */
export function pickSession(
  list: readonly SessionInfo[],
  current: string | undefined,
  sticky: boolean
): string | undefined {
  const listed = list.some(({ id }) => id === current);

  if (sticky && listed) return current;
  const embedded = newest(list.filter(session => session.embedded));
  if (embedded !== undefined) return embedded.id;
  if (listed) return current;
  return newest(list)?.id;
}

/**
 * The delay of the next session retry: the backoff of `attempt`, cut so the last retry lands on
 * the moment `lost` turns into `empty`.
 *
 * @param ctx - Domain context of link.
 * @returns The delay in ms.
 */
function sessionDelay(ctx: LinkCtx): number {
  const { state, config } = ctx;
  const delay = backoffDelay(state.attempt, config.retryMs);
  if (state.lostAt === undefined) return delay;

  const remaining = state.lostAt + EMPTY_AFTER_LOST_MS - Date.now();
  return remaining > 0 ? Math.min(delay, remaining) : delay;
}

/**
 * Schedules the next session retry; with a reason the status turns (or stays) lost with the new
 * `retryInMs`.
 *
 * @param ctx - Domain context of link.
 * @param reason - The lost reason, undefined to leave the status alone.
 */
export function scheduleSessionRetry(ctx: LinkCtx, reason?: string): void {
  const { state } = ctx;
  const retryInMs = sessionDelay(ctx);

  if (reason !== undefined) applyStatus(ctx, { type: "session-closed", reason, retryInMs });
  clearRetry(state);
  state.retryTimer = setTimeout(() => retrySession(ctx), retryInMs);
}

/**
 * Attaches in the background: a failure was already logged and a retry scheduled.
 *
 * @param ctx - Domain context of link.
 * @param sessionId - The session.
 */
function attachLater(ctx: LinkCtx, sessionId: string): void {
  attach(ctx, sessionId).catch(() => {
    // attach logged the failure and scheduled the session retry.
  });
}

/**
 * Re-runs the session pick: attaches a pick; without one, turns lost into empty after
 * EMPTY_AFTER_LOST_MS, or schedules the next retry with a longer delay.
 *
 * @param ctx - Domain context of link.
 */
export function retrySession(ctx: LinkCtx): void {
  const { state } = ctx;

  clearRetry(state);
  if (state.stopped || !state.open) return;

  const pick = pickSession(state.sessions, state.chosen, state.sticky);
  if (pick !== undefined) {
    attachLater(ctx, pick);
    return;
  }
  if (state.lostAt !== undefined && Date.now() - state.lostAt >= EMPTY_AFTER_LOST_MS) {
    applyStatus(ctx, { type: "lost-expired" });
    return;
  }
  state.attempt += 1;
  scheduleSessionRetry(ctx, state.status.kind === "lost" ? state.status.reason : undefined);
}

/**
 * The chosen session closed: wire subs dropped (records kept), manifest dropped, listeners told,
 * status lost with `retryInMs = retryMs`, session retry scheduled.
 *
 * @param ctx - Domain context of link.
 * @param reason - The hub's close reason.
 */
export function closeChosen(ctx: LinkCtx, reason: string): void {
  const { state } = ctx;
  const id = state.chosen;
  if (id === undefined) return;

  detachAll(ctx);
  state.chosen = undefined;
  state.sticky = false;
  state.lostAt = Date.now();
  state.heartbeat = undefined;
  state.attempt = 0;
  state.manifests.delete(id);
  notifyManifest(ctx);
  scheduleSessionRetry(ctx, reason);
}

/**
 * Fetches the manifest of a session. A failure of the current attach is logged and retried.
 *
 * @param ctx - Domain context of link.
 * @param sessionId - The session.
 * @param generation - The attach it belongs to.
 * @returns The manifest.
 */
async function fetchManifest(
  ctx: LinkCtx,
  sessionId: string,
  generation: number
): Promise<Manifest> {
  const { state } = ctx;

  try {
    return expectShape(
      await request(ctx, "game", "manifest", undefined, sessionId),
      readManifest,
      "manifest"
    );
  } catch (error) {
    if (generation === state.generation && state.open) {
      ctx.log.error("link:manifest-failed", { session: sessionId, ...describeError(error) });
      scheduleSessionRetry(ctx);
    }
    throw error;
  }
}

/**
 * Attaches a session: unwatches the old subs on a voluntary switch, makes it the chosen one,
 * fetches its manifest unless cached, tells the listeners and resubscribes every watch. An answer
 * that arrives after a newer attach is not applied.
 *
 * @param ctx - Domain context of link.
 * @param sessionId - The session to attach.
 * @returns Its manifest.
 */
export async function attach(ctx: LinkCtx, sessionId: string): Promise<Manifest> {
  const { state } = ctx;
  const previous = state.chosen;

  if (previous !== undefined && isAttached(state)) unwatchAll(ctx, previous);
  detachAll(ctx);
  clearRetry(state);
  state.chosen = sessionId;
  state.generation += 1;
  state.heartbeat = undefined;
  state.lostAt = undefined;
  if (!applyStatus(ctx, { type: "attached" })) emitStatus(ctx);

  const generation = state.generation;
  const manifest =
    state.manifests.get(sessionId) ?? (await fetchManifest(ctx, sessionId, generation));
  if (generation !== state.generation) return manifest;

  state.manifests.set(sessionId, manifest);
  state.attempt = 0;
  notifyManifest(ctx, manifest);
  resubscribeAll(ctx);
  return manifest;
}

/**
 * Applies a `sessions` list: stores it, drops manifests of closed ids, loses a chosen session the
 * list no longer has, then attaches the pick when it differs from the attached one (also right
 * after a reconnect, when nothing is attached on the new socket yet).
 *
 * @param ctx - Domain context of link.
 * @param list - The sessions from the hub.
 */
export function applySessions(ctx: LinkCtx, list: readonly SessionInfo[]): void {
  const { state } = ctx;
  if (state.stopped) return;

  const attached = isAttached(state);
  const ids = new Set(list.map(({ id }) => id));

  state.sessions = list;
  for (const id of state.manifests.keys()) if (!ids.has(id)) state.manifests.delete(id);
  if (state.chosen !== undefined && !ids.has(state.chosen)) closeChosen(ctx, "game_reloaded");

  const pick = pickSession(list, state.chosen, state.sticky);
  if (pick === undefined) {
    applyStatus(ctx, { type: "sessions", attached: state.chosen !== undefined, count: 0 });
    return;
  }
  if (pick !== state.chosen || !attached) attachLater(ctx, pick);
}

/**
 * `choose(session)`: makes an open session the sticky choice and attaches it.
 *
 * @param ctx - Domain context of link.
 * @param sessionId - The session.
 * @returns Its manifest; rejects -32003 `choose_session` for an id that is not open.
 */
export async function chooseSession(ctx: LinkCtx, sessionId: string): Promise<Manifest> {
  const { state } = ctx;

  if (!state.sessions.some(({ id }) => id === sessionId)) {
    throw wireError(errorCode.noSession, `Session "${sessionId}" is not open.`, {
      reason: "choose_session",
      retryable: false
    });
  }
  state.sticky = true;

  const cached = state.manifests.get(sessionId);
  if (sessionId === state.chosen && isAttached(state) && cached !== undefined) return cached;
  return attach(ctx, sessionId);
}
