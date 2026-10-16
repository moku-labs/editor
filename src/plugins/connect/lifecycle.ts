/**
 * @file connect plugin — onStart and onStop (spec 11 C2, C9). onStart turns the adb listener on
 * only for `wire: "auto"`, when `adb version` answers and the port is free; a failure is one info
 * line and the editor runs as before. onStop is state-only teardown (spec/08 §2: no emit, no log):
 * every timer cleared, every CDP socket closed, every recorded forward removed (awaited at most
 * 500 ms), leases and pairings cleared (their confirms answer false). It never stops device mode:
 * the hub's own onStop does.
 */
import { removeForward } from "./cdp/attach";
import { isPortInUse, turnWireOn } from "./mode";
import { clearAsking } from "./pairing/confirm";
import { within } from "./shared";
import { closeAttach } from "./telemetry/loop";
import type { ConnectCore, ConnectCtx } from "./types";
import { adb } from "./wire/run";

/** How long onStop waits for adb to remove the forwards, ms. */
export const STOP_WAIT_MS = 500;

/**
 * Why `wire: "auto"` left device mode off.
 *
 * @param error - What turning it on threw.
 * @returns "port_in_use" or "error".
 * @example
 * ```ts
 * offReason(new Error("boom")); // "error"
 * ```
 */
function offReason(error: unknown): string {
  return isPortInUse(error) || (error instanceof Error && error.message.includes(" is in use."))
    ? "port_in_use"
    : "error";
}

/**
 * connect's onStart: for `wire: "auto"`, device mode on by wire when adb answers.
 *
 * @param ctx - Domain context of connect.
 * @returns When device mode is on, or stayed off with its info line.
 */
export async function startConnect(ctx: ConnectCtx): Promise<void> {
  if (ctx.config.wire !== "auto") return;
  const version = await adb(ctx, { kind: "version" });
  if (version.code !== 0) {
    ctx.log.info("connect:auto-wire-off", {
      reason: version.missing ? "adb-missing" : "adb-error"
    });
    return;
  }
  try {
    await turnWireOn(ctx);
  } catch (error) {
    ctx.log.info("connect:auto-wire-off", { reason: offReason(error) });
  }
}

/**
 * connect's onStop. Touches the state only: no log, no emit, no hub call.
 *
 * @param ctx - The teardown context (its config and state).
 * @returns When every forward is removed, or after 500 ms.
 */
export async function stopConnect(ctx: ConnectCore): Promise<void> {
  const { state } = ctx;
  state.stopped = true;
  clearTimeout(state.timers.scan);
  clearTimeout(state.timers.publish);
  state.timers = { scan: undefined, publish: undefined };

  for (const attach of state.attaches.values()) {
    closeAttach(attach);
    const link = attach.cdp;
    attach.cdp = undefined;
    link?.client.close();
  }
  state.attaches.clear();
  state.watches.clear();
  state.scanUntil = 0;
  clearAsking(state);

  const removals = [...state.forwards.keys()].map(port => removeForward(ctx, port));
  await within(Promise.all(removals), STOP_WAIT_MS);
}
