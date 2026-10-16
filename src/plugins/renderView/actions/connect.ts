/**
 * @file renderView actions — the Connect panel's actions (spec 09 § M3, M7) through activeSource:
 * the scan lease while the panel is open, connectDevice, connectNetwork, confirm and refuse pairing,
 * useDevice, useLocal (never link.choose: the phone stays linked), stopDevices, and the local
 * preview's start (workspace.startLocalPreview), each with its pending row and its error.
 */
import { activeSourcePlugin } from "../../activeSource";
import { workspacePlugin } from "../../workspace";
import { CODE_MISMATCH, defaultTab } from "../derive/connect";
import { messageOf } from "../derive/words";
import { notifyMission } from "../state";
import type { MissionState, RenderViewCtx } from "../types";
import { closePopover } from "./popover";

/**
 * Opens the Connect panel on a tab (undefined: By wire when adb lists a phone, else On the network)
 * and starts the scan lease; another popover closes first.
 *
 * @param ctx - Domain context of renderView.
 * @param tab - The tab; undefined lets the directory choose.
 * @example
 * ```ts
 * openConnect(ctx, "network");
 * ctx.state.mission.connect.stopScan; // the lease's stop, called when the panel closes
 * ```
 */
export function openConnect(ctx: RenderViewCtx, tab: "wire" | "network" | undefined): void {
  const { mission } = ctx.state;
  const activeSource = ctx.require(activeSourcePlugin);
  if (mission.popover !== "connect") closePopover(mission);
  mission.popover = "connect";
  mission.connect.tab = tab ?? defaultTab(activeSource.directory());
  mission.connect.stopScan ??= activeSource.scan();
  notifyMission(mission);
}

/**
 * Closes the panel and stops the scan lease.
 *
 * @param mission - Mission control's state.
 * @example
 * ```ts
 * closeConnect(mission);
 * mission.connect.stopScan; // undefined
 * ```
 */
export function closeConnect(mission: MissionState): void {
  if (mission.popover === "connect") closePopover(mission);
  notifyMission(mission);
}

/**
 * Runs one Connect action with its pending row: the error of a rejection shows under the row (its
 * first line, without the editor's prefix).
 *
 * @param ctx - Domain context of renderView.
 * @param key - The row (a serial, a ticket, "network", a session).
 * @param run - The call.
 * @returns The call's answer; undefined when it rejected.
 */
async function pending<Answer>(
  ctx: RenderViewCtx,
  key: string,
  run: () => Promise<Answer>
): Promise<Answer | undefined> {
  const { connect } = ctx.state.mission;
  connect.pending = key;
  connect.error = undefined;
  notifyMission(ctx.state.mission);
  try {
    return await run();
  } catch (error) {
    connect.error = { key, message: messageOf(error) };
    return undefined;
  } finally {
    if (connect.pending === key) connect.pending = undefined;
    notifyMission(ctx.state.mission);
  }
}

/**
 * A wire row's Connect: activeSource.connectDevice; a rejection shows under the row.
 *
 * @param ctx - Domain context of renderView.
 * @param serial - WireDevice.serial.
 * @returns When it settled (never rejects).
 * @example
 * ```ts
 * await connectSerial(ctx, "R5CX30ABCDE"); // the phone is the source, or its error shows
 * ```
 */
export async function connectSerial(ctx: RenderViewCtx, serial: string): Promise<void> {
  const activeSource = ctx.require(activeSourcePlugin);
  await pending(ctx, serial, () => activeSource.connectDevice(serial));
}

/**
 * "Listen on the network": activeSource.connectNetwork (the LAN listener; the phone dials).
 *
 * @param ctx - Domain context of renderView.
 * @returns When it settled (never rejects).
 * @example
 * ```ts
 * await listenNetwork(ctx); // directory().mode.listen.lan is the address to dial
 * ```
 */
export async function listenNetwork(ctx: RenderViewCtx): Promise<void> {
  const activeSource = ctx.require(activeSourcePlugin);
  await pending(ctx, "network", () => activeSource.connectNetwork());
}

/**
 * Keeps the code typed for a pairing.
 *
 * @param mission - Mission control's state.
 * @param ticket - PairAsk.ticket.
 * @param code - The digits typed so far.
 * @example
 * ```ts
 * setCode(mission, "p-3a1f", "48");
 * ```
 */
export function setCode(mission: MissionState, ticket: string, code: string): void {
  mission.connect.codes.set(ticket, code);
  notifyMission(mission);
}

/**
 * An asking row's Link: activeSource.confirmPairing; false shows "That code does not match. Try
 * again." under the row.
 *
 * @param ctx - Domain context of renderView.
 * @param ticket - PairAsk.ticket.
 * @param code - The typed code.
 * @returns Whether the phone paired.
 * @example
 * ```ts
 * await confirmCode(ctx, "p-3a1f", "4821"); // true
 * ```
 */
export async function confirmCode(
  ctx: RenderViewCtx,
  ticket: string,
  code: string
): Promise<boolean> {
  const activeSource = ctx.require(activeSourcePlugin);
  const { connect } = ctx.state.mission;
  const paired = await pending(ctx, ticket, () => activeSource.confirmPairing(ticket, code));
  if (paired === false) connect.error = { key: ticket, message: CODE_MISMATCH };
  if (paired === true) connect.codes.delete(ticket);
  notifyMission(ctx.state.mission);
  return paired === true;
}

/**
 * An asking row's Refuse: activeSource.refusePairing.
 *
 * @param ctx - Domain context of renderView.
 * @param ticket - PairAsk.ticket.
 * @returns When it settled (never rejects).
 * @example
 * ```ts
 * await refuseTicket(ctx, "p-3a1f"); // the phone's request is answered "refused"
 * ```
 */
export async function refuseTicket(ctx: RenderViewCtx, ticket: string): Promise<void> {
  const activeSource = ctx.require(activeSourcePlugin);
  await pending(ctx, ticket, () => activeSource.refusePairing(ticket));
  ctx.state.mission.connect.codes.delete(ticket);
}

/**
 * A linked row's Use: activeSource.useDevice.
 *
 * @param ctx - Domain context of renderView.
 * @param session - LinkedEntry.session.
 * @returns When it settled (never rejects).
 * @example
 * ```ts
 * await useSession(ctx, "s-9"); // the Galaxy A26 is the source
 * ```
 */
export async function useSession(ctx: RenderViewCtx, session: string): Promise<void> {
  const activeSource = ctx.require(activeSourcePlugin);
  await pending(ctx, session, () => activeSource.useDevice(session));
}

/**
 * "Use local preview": activeSource.useLocal — never link.choose: the phone stays linked behind
 * activeSource's back otherwise.
 *
 * @param ctx - Domain context of renderView.
 * @returns When it settled (never rejects; a rejection is toasted).
 * @example
 * ```ts
 * await useLocalPreview(ctx); // the local preview is the source; the phone stays linked
 * ```
 */
export async function useLocalPreview(ctx: RenderViewCtx): Promise<void> {
  try {
    await ctx.require(activeSourcePlugin).useLocal();
  } catch (error) {
    ctx.require(workspacePlugin).toast(messageOf(error));
  }
}

/**
 * The footer's "Stop device mode": activeSource.stopDevices.
 *
 * @param ctx - Domain context of renderView.
 * @returns When it settled (never rejects).
 * @example
 * ```ts
 * await stopDeviceMode(ctx); // every phone unlinked; the page shows the local preview
 * ```
 */
export async function stopDeviceMode(ctx: RenderViewCtx): Promise<void> {
  const activeSource = ctx.require(activeSourcePlugin);
  await pending(ctx, "stop", () => activeSource.stopDevices());
}

/**
 * "Start local preview": workspace.startLocalPreview(); a rejection (a page without a game frame)
 * shows its first line as a toast.
 *
 * @param ctx - Domain context of renderView.
 * @returns When it settled (never rejects).
 * @example
 * ```ts
 * await startLocal(ctx); // the frame mounts and its session becomes the source
 * ```
 */
export async function startLocal(ctx: RenderViewCtx): Promise<void> {
  const workspace = ctx.require(workspacePlugin);
  try {
    await workspace.startLocalPreview();
  } catch (error) {
    workspace.toast(messageOf(error));
  }
}
