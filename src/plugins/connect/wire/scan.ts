/**
 * @file connect plugin — the scan (spec 11 C4): while a scan lease holds or device mode is on,
 * `adb devices -l` every `scanEveryMs` (A1) and one getprop (A2) per phone that became ready. adb
 * missing (code 127) stops the loop until the next `connect.scan`; a failing adb is an error and
 * the phones it knew stay. A phone that is no longer listed is forgotten and its telemetry
 * detached. Each round ends with the directory's publish (only on change).
 */
import { refreshDirectory } from "../directory";
import { unref } from "../shared";
import { detachDevice } from "../telemetry/loop";
import type { ConnectCtx, ConnectState, ListedDevice } from "../types";
import { parseDeviceList, parseGetprop } from "./parse";
import { adb } from "./run";

/**
 * Whether the scan should run: a scan lease holds or device mode is on.
 *
 * @param state - The state.
 * @returns True while it should.
 */
function scanWanted(state: ConnectState): boolean {
  return !state.stopped && (state.mode.on || state.scanUntil > Date.now());
}

/**
 * Whether the last adb call said adb is not on this computer.
 *
 * @param state - The state.
 * @returns True after a code-127 answer.
 */
function adbMissing(state: ConnectState): boolean {
  return !state.adb.available && state.adb.reason === "missing";
}

/**
 * Takes the phones of a listing: new ones recorded, states and ready times updated, the ones no
 * longer listed forgotten with their telemetry.
 *
 * @param ctx - Domain context of connect.
 * @param listed - The phones of `adb devices -l`.
 */
function takeListing(ctx: ConnectCtx, listed: readonly ListedDevice[]): void {
  const { state } = ctx;
  const now = Date.now();
  for (const device of listed) {
    const ready = device.state === "device";
    const record = state.wire.get(device.serial);
    if (record === undefined) {
      state.wire.set(device.serial, {
        ...device,
        facts: undefined,
        asked: false,
        readySince: ready ? now : undefined
      });
      continue;
    }
    record.state = device.state;
    record.transport = device.transport;
    record.readySince = ready ? (record.readySince ?? now) : undefined;
  }

  const serials = new Set(listed.map(device => device.serial));
  for (const serial of state.wire.keys()) if (!serials.has(serial)) forgetPhone(ctx, serial);
}

/**
 * Forgets a phone and detaches the telemetry of the device it was attached as.
 *
 * @param ctx - Domain context of connect.
 * @param serial - The phone.
 */
function forgetPhone(ctx: ConnectCtx, serial: string): void {
  ctx.state.wire.delete(serial);
  for (const attach of ctx.state.attaches.values()) {
    if (attach.serial === serial) detachDevice(ctx, attach.device);
  }
}

/**
 * Asks getprop of each ready phone not asked yet, one at a time; a failed answer is asked again
 * on the next round.
 *
 * @param ctx - Domain context of connect.
 * @returns When every phone was asked.
 */
async function askFacts(ctx: ConnectCtx): Promise<void> {
  for (const record of ctx.state.wire.values()) {
    if (record.state !== "device" || record.asked) continue;
    record.asked = true;
    const answer = await adb(ctx, { kind: "getprop", serial: record.serial });
    if (ctx.state.stopped) return;
    if (answer.code === 0) record.facts = parseGetprop(answer.text);
    else record.asked = false;
  }
}

/**
 * One scan round: list the phones, ask the new ones' facts, publish the directory.
 *
 * @param ctx - Domain context of connect.
 * @returns When the round is over.
 */
async function scanRound(ctx: ConnectCtx): Promise<void> {
  const { state } = ctx;
  const listing = await adb(ctx, { kind: "devices" });
  if (state.stopped) return;

  if (listing.missing) {
    state.adb = { available: false, reason: "missing" };
    for (const serial of state.wire.keys()) forgetPhone(ctx, serial);
  } else if (listing.code === 0) {
    state.adb = { available: true, reason: undefined };
    takeListing(ctx, parseDeviceList(listing.text));
    await askFacts(ctx);
  } else {
    state.adb = { available: false, reason: "error" };
  }
  refreshDirectory(ctx);
}

/**
 * Runs one scan round now; a caller that comes while one is in flight waits for that one.
 *
 * @param ctx - Domain context of connect.
 * @returns When the round is over.
 */
export function scanOnce(ctx: ConnectCtx): Promise<void> {
  const { state } = ctx;
  if (state.scanning !== undefined) return state.scanning;
  const round = scanRound(ctx).finally(() => {
    if (state.scanning === round) state.scanning = undefined;
  });
  state.scanning = round;
  return round;
}

/**
 * One turn of the loop: a round while the scan is wanted, then the next one in `scanEveryMs`; the
 * loop ends when it is not wanted, after onStop, or when adb is missing.
 *
 * @param ctx - Domain context of connect.
 * @returns When this turn's round is over.
 */
async function loopRound(ctx: ConnectCtx): Promise<void> {
  const { state } = ctx;
  state.timers.scan = undefined;
  if (scanWanted(state)) await scanOnce(ctx);
  if (!scanWanted(state) || adbMissing(state)) {
    state.looping = false;
    return;
  }
  state.timers.scan = unref(setTimeout(() => void loopRound(ctx), ctx.config.scanEveryMs));
}

/**
 * Starts the loop unless it runs. Without `retry` a missing adb keeps it stopped.
 *
 * @param ctx - Domain context of connect.
 * @param retry - Try adb again although it was missing.
 * @returns When the first round is over (at once when the loop ran already).
 */
function startLoop(ctx: ConnectCtx, retry: boolean): Promise<void> {
  const { state } = ctx;
  if (state.looping) return state.scanning ?? Promise.resolve();
  if (!scanWanted(state) || (!retry && adbMissing(state))) return Promise.resolve();
  state.looping = true;
  return loopRound(ctx);
}

/**
 * Renews the scan lease (`leaseMs`) and starts the loop when it is off, trying adb again when it
 * was missing (`connect.scan`).
 *
 * @param ctx - Domain context of connect.
 * @returns When the loop's first round is over, so the answer lists the phones.
 */
export function renewScan(ctx: ConnectCtx): Promise<void> {
  ctx.state.scanUntil = Date.now() + ctx.config.leaseMs;
  return startLoop(ctx, true);
}

/**
 * Starts the loop when device mode came on (the `listening` hook).
 *
 * @param ctx - Domain context of connect.
 */
export function ensureScan(ctx: ConnectCtx): void {
  void startLoop(ctx, false);
}
