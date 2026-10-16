/**
 * @file connect plugin — the one `hub:device` handler (spec 11 C2, C8), the hub's per-plugin event
 * seen through `depends: [hubPlugin]`: `listening` → device mode on (owner "other" when connect did
 * not cause it) and the scan loop; `connected` → the directory again (the match); `closed` → that
 * device's telemetry detached, the directory again; `stopped` → device mode off, the pairings
 * asking answered false, every attach detached, the directory again. Nothing after onStop.
 */
import type { HubDeviceEvent } from "../hub/types";
import { refreshDirectory } from "./directory";
import { noteListening, noteStopped } from "./mode";
import { clearAsking } from "./pairing/confirm";
import { detachDevice } from "./telemetry/loop";
import type { ConnectCtx, ConnectHooks } from "./types";
import { ensureScan } from "./wire/scan";

/**
 * Device mode stopped: off, no pairing asking, no attach, no lease.
 *
 * @param ctx - Domain context of connect.
 */
function onStopped(ctx: ConnectCtx): void {
  const { state } = ctx;
  noteStopped(state);
  clearAsking(state);
  for (const device of state.attaches.keys()) detachDevice(ctx, device);
  state.watches.clear();
  refreshDirectory(ctx);
}

/**
 * Handles one `hub:device` event.
 *
 * @param ctx - Domain context of connect.
 * @param event - The event.
 */
function onDeviceEvent(ctx: ConnectCtx, event: HubDeviceEvent): void {
  switch (event.kind) {
    case "listening": {
      noteListening(ctx.state, event.listen);
      ensureScan(ctx);
      refreshDirectory(ctx);
      return;
    }
    case "connected": {
      refreshDirectory(ctx);
      return;
    }
    case "closed": {
      detachDevice(ctx, event.device.id);
      refreshDirectory(ctx);
      return;
    }
    case "stopped": {
      onStopped(ctx);
      return;
    }
    case "lines": {
      // A batch of a device's log: the collector's.
      return;
    }
  }
}

/**
 * The hooks of connect.
 *
 * @param ctx - Domain context of connect.
 * @returns The `hub:device` hook.
 */
export function createConnectHooks(ctx: ConnectCtx): ConnectHooks {
  return {
    "hub:device": event => {
      if (!ctx.state.stopped) onDeviceEvent(ctx, event);
    }
  };
}
