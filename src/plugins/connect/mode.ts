/* eslint-disable unicorn/no-null -- null is "device mode off" in the state and on the wire */
/**
 * @file connect plugin — device mode on request (spec 11 C1, C2): turn the adb listener on
 * (`hub.listenDevices` with connect's pairing confirm), add the LAN listener, turn either off —
 * only while device mode is connect's. `state.mode` follows `hub:device`: a `listening` connect did
 * not cause (moku-editor perf) makes the owner "other". The hub's listen errors become wire errors:
 * a taken port `port_in_use`, no LAN address `no_lan`.
 */
import { hubPlugin } from "../hub";
import type { DeviceListen } from "../hub/types";
import { errorCode, wireError } from "../registry/protocol";
import { createPairConfirm } from "./pairing/confirm";
import type { ConnectCtx, ConnectState } from "./types";

/** The port of a taken-port message of the hub. */
const TAKEN_PORT = /port (\d+) is in use/;

/** What the hub says when the computer has no LAN address. */
const NO_LAN = "no LAN address";

/**
 * Device mode came on or its listen changed: on, the listen kept, the owner kept (connect sets
 * "connect" before it asks the hub), else "other".
 *
 * @param state - The state.
 * @param listen - Where device mode listens now.
 */
export function noteListening(state: ConnectState, listen: DeviceListen): void {
  if (!state.mode.on) state.modeSince = Date.now();
  state.mode = { on: true, owner: state.mode.owner ?? "other", listen };
}

/**
 * Device mode went off.
 *
 * @param state - The state.
 */
export function noteStopped(state: ConnectState): void {
  state.mode = { on: false, owner: null, listen: null };
  state.modeSince = undefined;
}

/**
 * Whether an error is the hub's taken port.
 *
 * @param error - What the hub threw.
 * @returns True for EADDRINUSE.
 * @example
 * ```ts
 * isPortInUse(Object.assign(new Error("[moku-editor] port 47600 is in use."), { code: "EADDRINUSE" })); // true
 * ```
 */
export function isPortInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

/**
 * The wire error of a listen that failed: a taken port is `port_in_use` (the tools page's own
 * advice), no LAN address `no_lan` (the hub's message); anything else as it was.
 *
 * @param error - What the hub threw.
 * @returns The error to throw.
 * @example
 * ```ts
 * listenError(Object.assign(new Error("[moku-editor] port 47600 is in use."), { code: "EADDRINUSE" })).message; // "[moku-editor] port 47600 is in use.\n  Is moku-editor perf running? Stop it, or connect from its tools page."
 * ```
 */
export function listenError(error: unknown): unknown {
  if (isPortInUse(error) && error instanceof Error) {
    const port = TAKEN_PORT.exec(error.message)?.[1] ?? "of device mode";
    return wireError(
      errorCode.commandFailed,
      `port ${port} is in use.\n  Is moku-editor perf running? Stop it, or connect from its tools page.`,
      { reason: "port_in_use", retryable: false }
    );
  }
  if (error instanceof Error && error.message.includes(NO_LAN)) {
    return wireError(errorCode.commandFailed, error.message, {
      reason: "no_lan",
      retryable: false
    });
  }
  return error;
}

/**
 * Asks the hub for device mode with connect as its owner.
 *
 * @param ctx - Domain context of connect.
 * @returns Where device mode listens.
 * @throws {Error} The listen's wire error; device mode stays off.
 */
async function listenAsOwner(ctx: ConnectCtx): Promise<DeviceListen> {
  const { state } = ctx;
  state.mode = { ...state.mode, owner: "connect" };
  try {
    const listen = await ctx.require(hubPlugin).listenDevices({ confirm: createPairConfirm(ctx) });
    noteListening(state, listen);
    return listen;
  } catch (error) {
    if (!state.mode.on) noteStopped(state);
    throw listenError(error);
  }
}

/**
 * Turns device mode on with the adb listener when it is off (connect becomes its owner). While it
 * is on — connect's or perf's — it answers the listen and asks nothing. Calls that come while a
 * turn-on is in flight share it.
 *
 * @param ctx - Domain context of connect.
 * @returns Where device mode listens.
 * @throws {Error} -32000 `port_in_use` when the device port is taken.
 */
export function turnWireOn(ctx: ConnectCtx): Promise<DeviceListen> {
  const { state } = ctx;
  if (state.mode.on && state.mode.listen !== null) return Promise.resolve(state.mode.listen);
  state.turning ??= listenAsOwner(ctx).finally(() => {
    state.turning = undefined;
  });
  return state.turning;
}

/**
 * Turns device mode on when it is off, then adds the LAN listener.
 *
 * @param ctx - Domain context of connect.
 * @returns Where device mode listens, with `lan`.
 * @throws {Error} -32000 `no_lan` without a LAN address, `port_in_use` for a taken port.
 */
export async function turnNetworkOn(ctx: ConnectCtx): Promise<DeviceListen> {
  await turnWireOn(ctx);
  try {
    const listen = await ctx.require(hubPlugin).listenLan();
    noteListening(ctx.state, listen);
    return listen;
  } catch (error) {
    throw listenError(error);
  }
}

/**
 * Turns the LAN listener off (`lan`), or all of device mode — only while device mode is connect's.
 * With device mode off it does nothing.
 *
 * @param ctx - Domain context of connect.
 * @param lan - True to stop only the LAN listener (phones by wire stay).
 * @returns Where device mode listens after it, null when it is off.
 * @throws {Error} -32007 `not_owner` while device mode is moku-editor perf's.
 */
export async function turnOff(ctx: ConnectCtx, lan: boolean): Promise<DeviceListen | null> {
  const { state } = ctx;
  if (!state.mode.on) return null;
  if (state.mode.owner !== "connect") {
    throw wireError(
      errorCode.unauthorized,
      "device mode belongs to moku-editor perf.\n  Stop it in its terminal, or connect from its tools page.",
      { reason: "not_owner", retryable: false }
    );
  }

  const hub = ctx.require(hubPlugin);
  if (lan) {
    await hub.stopLan();
    const listen = state.mode.listen === null ? null : { ...state.mode.listen, lan: null };
    if (listen !== null) noteListening(state, listen);
    return listen;
  }
  await hub.stopDevices();
  noteStopped(state);
  return null;
}
