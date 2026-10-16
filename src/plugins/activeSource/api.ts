/**
 * @file activeSource plugin — api factory: the source and the local preview, the switch, the
 * Connect panel's actions, the notice and markers, the telemetry of the active device, the
 * connection bar's label, health and clock, composed from the domain modules. The contract of each
 * member is on `ActiveSourceApi` in `types.ts`.
 */
import { linkPlugin } from "../link";
import {
  confirmPairing,
  connectDevice,
  listenOn,
  reconnect,
  refusePairing,
  stopDevices
} from "./actions";
import { medianOffset } from "./health";
import { openScan } from "./leases";
import { labelOf } from "./names";
import { closeNotice } from "./notice";
import { switchToDevice, switchToLocal } from "./switch";
import type { ActiveSourceApi, ActiveSourceCtx, SourceHealth } from "./types";

/**
 * Adds a listener behind a wrapper (the same function added twice is two entries).
 *
 * @param listeners - The set.
 * @param fn - The listener.
 * @returns An idempotent unsubscribe.
 */
function addListener<T>(listeners: Set<(value: T) => void>, fn: (value: T) => void): () => void {
  /**
   * The wrapper of `fn`.
   *
   * @param value - The value to pass on.
   */
  const entry = (value: T): void => {
    fn(value);
  };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}

/**
 * Creates the activeSource api.
 *
 * @param ctx - Domain context of activeSource.
 * @returns The ActiveSourceApi (`app.activeSource`).
 */
export function createActiveSourceApi(ctx: ActiveSourceCtx): ActiveSourceApi {
  const { state } = ctx;
  const link = () => ctx.require(linkPlugin);

  return {
    current: () => state.current,

    preview: () => state.preview,

    useDevice: session => switchToDevice(ctx, session, "user"),

    useLocal: () => switchToLocal(ctx),

    onChange: fn => addListener(state.listeners, fn),

    directory: () => link().published("devices"),

    scan: () => openScan(ctx),

    connectWire: () => listenOn(ctx, "connect.wire"),

    connectNetwork: () => listenOn(ctx, "connect.network"),

    confirmPairing: (ticket, code) => confirmPairing(ctx, ticket, code),

    refusePairing: ticket => refusePairing(ctx, ticket),

    stopDevices: options => stopDevices(ctx, options),

    telemetry: () => state.telemetry,

    onTelemetry: fn => addListener(state.telemetryListeners, fn),

    markers: () => [...state.markers],

    notice: () => state.notice,

    dismissNotice: () => {
      closeNotice(state);
    },

    reconnect: () => reconnect(ctx),

    connectDevice: serial => connectDevice(ctx, serial),

    label: () => labelOf(state.current, link().published("devices"), link().sessions()),

    health: (): SourceHealth => {
      const { current } = state;
      const device = current.kind === "device";
      let kind: SourceHealth["kind"] = "local";
      if (device) kind = current.device.link === "adb" ? "wire" : "network";
      return {
        kind,
        // eslint-disable-next-line unicorn/no-null -- the spec's "no latency" for the local preview
        latencyMs: device ? state.health.latencyMs : null,
        samples: state.health.samples,
        head: state.health.head
      };
    },

    clockOffsetMs: () => (state.current.kind === "device" ? medianOffset(state.offsets) : 0),

    openConnect: tab => {
      ctx.emit("activeSource:connect-requested", { tab });
    }
  };
}
