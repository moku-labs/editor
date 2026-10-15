/**
 * @file bridge plugin — the hooks: `overlay:connect` (the global intent of the overlay's Link tab)
 * dials the address like `connect(address)`, after a second check of the address; the recorder's
 * `recorder:status` ships what is pending (the bridge reads none of its numbers).
 */
import { parseAddress } from "../hub/protocol";
import { dial } from "./api";
import { depsOf } from "./lifecycle";
import { shipNext } from "./lines";
import type { BridgeCtx, BridgeDeps, BridgeHooks } from "./types";

/**
 * Builds the bridge's hooks over the domain deps (unit tests pass fakes).
 *
 * @param deps - The domain deps.
 * @returns The `overlay:connect` and `recorder:status` handlers.
 */
export function buildBridgeHooks(deps: BridgeDeps): BridgeHooks {
  return {
    "overlay:connect": ({ address }) => {
      if (parseAddress(address) === undefined) {
        deps.log.warn("bridge:bad-address", { address });
        return;
      }
      dial(deps, address);
    },
    "recorder:status": () => {
      shipNext(deps);
    }
  };
}

/**
 * Creates the bridge's hooks. The kernel registers hooks before it builds the apis, so
 * `ctx.require` answers an empty api here: the deps are built at the first event, once.
 *
 * @param ctx - Plugin context of the bridge.
 * @returns The hooks over the deps of `ctx`.
 */
export function createBridgeHooks(ctx: BridgeCtx): BridgeHooks {
  let hooks: BridgeHooks | undefined;

  /**
   * The hooks over the deps, built on first use.
   *
   * @returns The hooks.
   */
  const ready = (): BridgeHooks => {
    hooks ??= buildBridgeHooks(depsOf(ctx));
    return hooks;
  };
  return {
    "overlay:connect": payload => {
      ready()["overlay:connect"](payload);
    },
    "recorder:status": payload => {
      ready()["recorder:status"](payload);
    }
  };
}
