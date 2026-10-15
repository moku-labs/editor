/**
 * @file bridge plugin — api factory: status (from the phase and channel.heartbeat), session, the
 * device link, and connect (switch to another computer in device mode).
 */
import { parseAddress } from "../hub/protocol";
import { redial } from "./connection/loop";
import { writeRemembered } from "./connection/pairing-store";
import { depsOf } from "./lifecycle";
import { currentStatus, linkOf } from "./status";
import type { BridgeApi, BridgeCtx, BridgeDeps } from "./types";

/**
 * Switches to device mode at `address` and dials it now: remembers it as the last address,
 * closes the current socket and connects with the streak reset. The address already live does
 * nothing; before start the address waits for start; after stop nothing happens.
 *
 * @param deps - The domain deps.
 * @param address - `host:port` or `[v6]:port`.
 * @throws {TypeError} `[moku-editor] bridge.connect needs host:port, got "<address>".` (argument
 *   validation); nothing changes then.
 */
export function dial(deps: BridgeDeps, address: string): void {
  // Guard: an address parseAddress refuses changes nothing.
  const parsed = parseAddress(address);
  if (parsed === undefined) {
    throw new TypeError(
      `[moku-editor] bridge.connect needs host:port, got "${address}".\n  Pass an address like "192.168.1.5:47600".`
    );
  }

  // Decide: the address already live and a stopped bridge need nothing.
  const { state } = deps;
  const target = parsed.text;
  const live = state.mode === "device" && state.address === target && state.phase === "open";
  if (live || state.phase === "stopped") return;

  // Commit: device mode at the address, remembered as the last one; a started bridge dials now.
  if (state.address !== target) state.pairing = undefined;
  state.mode = "device";
  state.address = target;
  state.pairNext = false;
  state.remembered = { ...state.remembered, last: target };
  writeRemembered(deps);
  if (state.phase !== "idle") redial(deps);
}

/**
 * Builds the bridge api over the domain deps (unit tests pass fakes).
 *
 * @param deps - The domain deps.
 * @returns The api: status, session and link read state; connect dials.
 */
export function buildBridgeApi(deps: BridgeDeps): BridgeApi {
  return {
    status: () => currentStatus(deps),
    session: () => deps.state.session,
    link: () => linkOf(deps.state),
    connect: address => {
      dial(deps, address);
    }
  };
}

/**
 * Creates the bridge api.
 *
 * @param ctx - Plugin context of the bridge.
 * @returns The api over the deps of `ctx`.
 */
export function createBridgeApi(ctx: BridgeCtx): BridgeApi {
  return buildBridgeApi(depsOf(ctx));
}
