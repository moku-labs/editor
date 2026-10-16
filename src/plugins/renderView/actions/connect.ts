/**
 * @file renderView actions — the Connect panel's actions (spec 09 § M3, M7) through
 * activeSource: the scan lease while the panel is open, connectDevice, connectNetwork, confirm
 * and refuse pairing, useDevice, useLocal, stopDevices, with their pending and error state.
 * Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other
 * Mission control units build against; build wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { MissionState, RenderViewCtx } from "../types";

/**
 * Opens the Connect panel and starts the scan lease (activeSource.scan()).
 *
 * @param _ctx - Domain context of renderView.
 * @param _tab - The tab; undefined: wire when a phone is plugged in, else network.
 * @throws {Error} Until build wave 3: "renderView actions/openConnect is not built yet".
 */
export function openConnect(_ctx: RenderViewCtx, _tab: "wire" | "network" | undefined): void {
  notBuilt("actions/openConnect", 3);
}

/**
 * Closes the panel and stops the scan lease.
 *
 * @param _mission - Mission control's state.
 * @throws {Error} Until build wave 3: "renderView actions/closeConnect is not built yet".
 */
export function closeConnect(_mission: MissionState): void {
  notBuilt("actions/closeConnect", 3);
}

/**
 * A wire row's Connect: activeSource.connectDevice; a rejection shows under the row.
 *
 * @param _ctx - Domain context of renderView.
 * @param _serial - WireDevice.serial.
 * @returns When it settled (never rejects).
 * @throws {Error} Until build wave 3: "renderView actions/connectSerial is not built yet".
 */
export function connectSerial(_ctx: RenderViewCtx, _serial: string): Promise<void> {
  return notBuilt("actions/connectSerial", 3);
}

/**
 * "Listen on the network": activeSource.connectNetwork.
 *
 * @param _ctx - Domain context of renderView.
 * @returns When it settled (never rejects).
 * @throws {Error} Until build wave 3: "renderView actions/listenNetwork is not built yet".
 */
export function listenNetwork(_ctx: RenderViewCtx): Promise<void> {
  return notBuilt("actions/listenNetwork", 3);
}

/**
 * An asking row's Link: activeSource.confirmPairing; false shows "That code does not match".
 *
 * @param _ctx - Domain context of renderView.
 * @param _ticket - PairAsk.ticket.
 * @param _code - The typed code.
 * @returns Whether the phone paired.
 * @throws {Error} Until build wave 3: "renderView actions/confirmCode is not built yet".
 */
export function confirmCode(_ctx: RenderViewCtx, _ticket: string, _code: string): Promise<boolean> {
  return notBuilt("actions/confirmCode", 3);
}

/**
 * An asking row's Refuse: activeSource.refusePairing.
 *
 * @param _ctx - Domain context of renderView.
 * @param _ticket - PairAsk.ticket.
 * @returns When it settled.
 * @throws {Error} Until build wave 3: "renderView actions/refuseTicket is not built yet".
 */
export function refuseTicket(_ctx: RenderViewCtx, _ticket: string): Promise<void> {
  return notBuilt("actions/refuseTicket", 3);
}

/**
 * A linked row's Use: activeSource.useDevice.
 *
 * @param _ctx - Domain context of renderView.
 * @param _session - LinkedEntry.session.
 * @returns When it settled.
 * @throws {Error} Until build wave 3: "renderView actions/useSession is not built yet".
 */
export function useSession(_ctx: RenderViewCtx, _session: string): Promise<void> {
  return notBuilt("actions/useSession", 3);
}

/**
 * "Use local preview": activeSource.useLocal (never link.choose; the phone stays linked).
 *
 * @param _ctx - Domain context of renderView.
 * @returns When it settled.
 * @throws {Error} Until build wave 3: "renderView actions/useLocalPreview is not built yet".
 */
export function useLocalPreview(_ctx: RenderViewCtx): Promise<void> {
  return notBuilt("actions/useLocalPreview", 3);
}

/**
 * The footer's "Stop device mode": activeSource.stopDevices.
 *
 * @param _ctx - Domain context of renderView.
 * @returns When it settled.
 * @throws {Error} Until build wave 3: "renderView actions/stopDeviceMode is not built yet".
 */
export function stopDeviceMode(_ctx: RenderViewCtx): Promise<void> {
  return notBuilt("actions/stopDeviceMode", 3);
}
