/**
 * @file activeSource plugin — what link's session list and choice mean for the source (spec 11 § 4
 * B2, B3, B6–B8): the active device leaving, the local frame reloading behind a device, a device
 * linking (autoUse once per device id, else a "connected — Use" notice), a lost device coming back
 * (the rejoin rule), the first list's choice, and a choice made elsewhere.
 */
import type { SessionDevice } from "../hub/protocol";
import { linkPlugin } from "../link";
import type { SessionInfo } from "../registry/protocol";
import { nameOf, sentence } from "./names";
import { markBack, showNotice } from "./notice";
import { adopt, loseSource, messageOf, pauseNewOwn, switchToDevice } from "./switch";
import type { ActiveSourceCtx } from "./types";

/**
 * True when the lost device may come back as the source now: Reconnect waits for it, or it left
 * less than rejoinMs ago.
 *
 * @param ctx - Domain context of activeSource.
 * @param device - A device id.
 * @returns Whether its session would be rejoined.
 */
function mayRejoin(ctx: ActiveSourceCtx, device: string): boolean {
  const { lost } = ctx.state;
  if (lost?.device !== device) return false;
  return lost.waiting || Date.now() - lost.at < ctx.config.rejoinMs;
}

/**
 * Starts a switch from a list or a hook without a caller to answer: a failure is logged.
 *
 * @param ctx - Domain context of activeSource.
 * @param session - The device session.
 * @param reason - connected or rejoined.
 */
function useInBackground(
  ctx: ActiveSourceCtx,
  session: string,
  reason: "connected" | "rejoined"
): void {
  switchToDevice(ctx, session, reason).catch((error: unknown) => {
    ctx.log.warn("activeSource:switch-failed", { session, reason, message: messageOf(error) });
  });
}

/**
 * A device session in the list (B3): the lost device returning (rejoin, or "back" on its notice),
 * a new device id (autoUse while the local preview is the source, else a notice while a device is
 * the source). Every device id counts once.
 *
 * @param ctx - Domain context of activeSource.
 * @param session - The session.
 * @param device - Its device.
 */
function noteDevice(ctx: ActiveSourceCtx, session: SessionInfo, device: SessionDevice): void {
  const { state, config } = ctx;
  const mine = state.current.session === session.id || state.target === session.id;

  if (state.lost?.device === device.id) {
    if (mine) return;
    if (mayRejoin(ctx, device.id)) useInBackground(ctx, session.id, "rejoined");
    else markBack(state, device.id);
    return;
  }
  if (state.seen.has(device.id)) return;
  state.seen.add(device.id);
  if (mine) return;

  if (config.autoUse && state.current.kind === "local" && state.target === undefined) {
    useInBackground(ctx, session.id, "connected");
  } else if (state.current.kind === "device" || state.target !== undefined) {
    const name = nameOf(device, ctx.require(linkPlugin).published("devices"));
    showNotice(state, config, {
      device: device.id,
      model: device.model,
      text: `${sentence(name)} connected — Use`,
      back: true
    });
  }
}

/**
 * True when a device is the source or a switch to a device is in flight.
 *
 * @param ctx - Domain context of activeSource.
 * @param list - The sessions.
 * @returns Whether the local preview should be paused.
 */
function deviceAhead(ctx: ActiveSourceCtx, list: readonly SessionInfo[]): boolean {
  const { current, target } = ctx.state;
  if (target === undefined) return current.kind === "device";
  return list.some(session => session.id === target && session.device !== undefined);
}

/**
 * Follows the local preview's session (B7): a new own session while a device is the source is
 * paused; the preview reads none without a session and running once one appears.
 *
 * @param ctx - Domain context of activeSource.
 * @param list - The sessions.
 */
function trackOwn(ctx: ActiveSourceCtx, list: readonly SessionInfo[]): void {
  const { state } = ctx;
  const own = ctx.require(linkPlugin).ownSession();
  const previous = state.own;
  state.own = own;

  if (own === undefined) {
    if (state.preview.state === "running") state.preview = { state: "none" };
    return;
  }
  if (state.preview.state === "none") state.preview = { state: "running" };
  if (own !== previous && deviceAhead(ctx, list)) pauseNewOwn(ctx);
}

/**
 * Applies one session list of link (after link applied it): the loss of the active device (B6,
 * reason stopped while stopDevices runs or the directory says device mode is off), the own frame
 * (B7), the devices (B3), then the first choice (B2: a source without a session takes link's).
 *
 * @param ctx - Domain context of activeSource.
 * @param list - The sessions.
 */
export function handleSessions(ctx: ActiveSourceCtx, list: readonly SessionInfo[]): void {
  const { state } = ctx;
  if (state.stopped) return;
  const link = ctx.require(linkPlugin);

  const { current } = state;
  const gone = !list.some(session => session.id === current.session);
  if (current.kind === "device" && state.target === undefined && gone) {
    const off = state.stopping || link.published("devices")?.mode.on === false;
    loseSource(ctx, off ? "stopped" : "lost");
  }
  trackOwn(ctx, list);
  for (const session of list) {
    if (session.device !== undefined) noteDevice(ctx, session, session.device);
  }

  const chosen = link.session();
  if (state.current.session === null && state.target === undefined && chosen !== undefined) {
    adopt(ctx, chosen);
  }
}

/**
 * The `link:status` hook (B8): a session link chose without this plugin becomes the source
 * (adopted). Not while a switch is in flight, not the loss of the active device (B6 follows from
 * the list), and not a device B3 is about to use (a new one under autoUse, a lost one rejoining).
 *
 * @param ctx - Domain context of activeSource.
 * @param session - The session link chose.
 */
export function followChoice(ctx: ActiveSourceCtx, session: string): void {
  const { state, config } = ctx;
  const { current } = state;
  if (state.stopped || state.target !== undefined || session === current.session) return;

  const list = ctx.require(linkPlugin).sessions();
  const info = list.find(item => item.id === session);
  if (info === undefined) return;
  if (current.kind === "device" && !list.some(item => item.id === current.session)) return;

  const id = info.device?.id;
  if (id !== undefined) {
    if (mayRejoin(ctx, id)) return;
    if (!state.seen.has(id) && config.autoUse && current.kind === "local") return;
  }
  adopt(ctx, session);
}
