/**
 * @file link plugin — the session choice (R7: sticky choice, then this page's own game frame, then
 * embedded first, then newest by `connectedAt`; another tools tab's frame only by `choose()`),
 * attach (manifest + resubscribe), session loss and the session retry.
 */

import type { Manifest, SessionInfo } from "../../registry/protocol";
import { errorCode, isRetryable, wireError } from "../../registry/protocol";
import { describeError, request } from "../rpc/calls";
import { expectShape, readManifest } from "../rpc/shapes";
import { backoffDelay } from "../socket/backoff";
import { clearRetry, isAttached } from "../state";
import { applyStatus, emitStatus } from "../status/machine";
import { detachAll, resubscribeAll, unwatchAll } from "../subscriptions/watch";
import type { LinkCtx } from "../types";
import { EMPTY_AFTER_LOST_MS } from "../types";
import { frameOf, isOtherFrame } from "./frame";
import { notifyManifest } from "./manifest";

/**
 * The session with the largest `connectedAt` (the first of equals).
 *
 * @param list - Sessions.
 * @returns The newest, or undefined for none.
 * @example
 * ```ts
 * newest([
 *   { id: "a", game: "g", page: "/", embedded: false, connectedAt: 100 },
 *   { id: "b", game: "g", page: "/", embedded: false, connectedAt: 200 },
 *   { id: "c", game: "g", page: "/", embedded: true, connectedAt: 200 }
 * ])?.id; // "b": the first of the two newest
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
 * True when a session is the game frame of another tools tab: embedded, with a frame id in its
 * page that is not `frame`.
 *
 * @param session - A session.
 * @param frame - The frame id of this tools page.
 * @returns Whether the session belongs to another tools tab.
 */
function isOtherTab(session: SessionInfo, frame: string): boolean {
  return session.embedded && isOtherFrame(session.page, frame);
}

/**
 * Picks the session to attach (pure): the sticky current one, else the newest embedded session
 * of this page's own frame, else the newest other embedded one, else the current one, else the
 * newest. With a frame id, the game frame of another tools tab is never picked on its own (only
 * `choose()` attaches it).
 *
 * @param list - The open sessions.
 * @param current - The chosen session.
 * @param sticky - Whether `current` was chosen through `choose()`.
 * @param frame - The frame id of this tools page; omitted, frame ids are not looked at.
 * @returns The session id, or undefined for an empty list.
 */
export function pickSession(
  list: readonly SessionInfo[],
  current: string | undefined,
  sticky: boolean,
  frame?: string
): string | undefined {
  if (sticky && list.some(({ id }) => id === current)) return current;

  // Leave the other tabs' frames out, then: own frame, any other embedded, current, newest.
  const open = frame === undefined ? list : list.filter(session => !isOtherTab(session, frame));
  const embedded = open.filter(session => session.embedded);
  const own = frame === undefined ? [] : embedded.filter(({ page }) => frameOf(page) === frame);
  const pick = newest(own) ?? newest(embedded);
  if (pick !== undefined) return pick.id;
  if (open.some(({ id }) => id === current)) return current;
  return newest(open)?.id;
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

  const pick = pickSession(state.sessions, state.chosen, state.sticky, state.frame);
  if (pick !== undefined) {
    attachLater(ctx, pick);
    return;
  }
  const hasExpired = state.lostAt !== undefined && Date.now() - state.lostAt >= EMPTY_AFTER_LOST_MS;
  if (hasExpired) {
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
 * Fetches the manifest of a session. A failure of the current attach is logged and retried: a
 * retryable one (a timeout, a reloading game) at debug, every other at error.
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
      const details = { session: sessionId, ...describeError(error) };
      if (isRetryable(error)) ctx.log.debug("link:manifest-failed", details);
      else ctx.log.error("link:manifest-failed", details);
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

  // Leave the old session: its subs, the retry timer and the lost clock.
  if (previous !== undefined && isAttached(state)) unwatchAll(ctx, previous);
  detachAll(ctx);
  clearRetry(state);
  state.chosen = sessionId;
  state.generation += 1;
  state.heartbeat = undefined;
  state.lostAt = undefined;
  if (!applyStatus(ctx, { type: "attached" })) emitStatus(ctx);

  // Fetch the manifest unless cached; drop the answer when a newer attach started meanwhile.
  const generation = state.generation;
  const manifest =
    state.manifests.get(sessionId) ?? (await fetchManifest(ctx, sessionId, generation));
  if (generation !== state.generation) return manifest;

  // Keep the manifest, tell the listeners and resubscribe every watch.
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

  // Store the list, forget closed sessions and lose a chosen one that is gone.
  state.sessions = list;
  for (const id of state.manifests.keys()) if (!ids.has(id)) state.manifests.delete(id);
  const lostChosen = state.chosen !== undefined && !ids.has(state.chosen);
  if (lostChosen) closeChosen(ctx, "game_reloaded");

  // Attach the pick when it is new or nothing is attached on this socket yet.
  const pick = pickSession(list, state.chosen, state.sticky, state.frame);
  if (pick === undefined) {
    applyStatus(ctx, { type: "sessions", attached: state.chosen !== undefined, count: 0 });
    return;
  }
  const needsAttach = pick !== state.chosen || !attached;
  if (needsAttach) attachLater(ctx, pick);
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
