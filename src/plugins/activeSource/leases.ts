/**
 * @file activeSource plugin — connect's leases (spec 11 § 4 B4 step 4, scan()): the scan lease
 * while a Connect panel is open and the watch lease of the active device, renewed by one interval
 * every renewMs that runs only while a lease is needed. A lease call that fails is logged at debug:
 * the next renewal tries again, and connect ends a lease nobody renews.
 */
import { linkPlugin } from "../link";
import type { Json } from "../registry/protocol";
import type { ActiveSourceCtx } from "./types";

/**
 * Calls one of connect's lease methods without waiting for it.
 *
 * @param ctx - Domain context of activeSource.
 * @param method - `connect.scan`, `connect.watch` or `connect.unwatch`.
 * @param params - Its params.
 */
export function callLease(ctx: ActiveSourceCtx, method: string, params: Json): void {
  ctx
    .require(linkPlugin)
    .callEditor(method, params)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.log.debug("activeSource:lease-failed", { method, message });
    });
}

/**
 * One renewal: the scan lease while a scan is open, the watch lease while a device is the source.
 *
 * @param ctx - Domain context of activeSource.
 */
function renew(ctx: ActiveSourceCtx): void {
  const { state } = ctx;
  if (state.scans > 0) callLease(ctx, "connect.scan", {});
  if (state.current.kind === "device") {
    callLease(ctx, "connect.watch", { device: state.current.device.id });
  }
}

/**
 * Starts the renewal interval when a lease is needed and stops it when none is.
 *
 * @param ctx - Domain context of activeSource.
 */
export function syncRenew(ctx: ActiveSourceCtx): void {
  const { state } = ctx;
  const needed = !state.stopped && (state.scans > 0 || state.current.kind === "device");

  if (needed && state.timers.renew === undefined) {
    state.timers.renew = setInterval(() => renew(ctx), ctx.config.renewMs);
  } else if (!needed && state.timers.renew !== undefined) {
    clearInterval(state.timers.renew);
    state.timers.renew = undefined;
  }
}

/**
 * Opens a scan: calls `connect.scan` now and renews it until the returned stop.
 *
 * @param ctx - Domain context of activeSource.
 * @returns An idempotent stop.
 */
export function openScan(ctx: ActiveSourceCtx): () => void {
  const { state } = ctx;
  state.scans += 1;
  callLease(ctx, "connect.scan", {});
  syncRenew(ctx);

  let open = true;
  return () => {
    if (!open) return;
    open = false;
    state.scans -= 1;
    syncRenew(ctx);
  };
}
