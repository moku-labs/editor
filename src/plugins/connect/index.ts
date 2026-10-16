/**
 * Complex tier — connect a phone from the tools page (spec 11 § 3): device mode on request (the
 * adb listener, the LAN listener), the device directory published as `editor.devices`, the pairing
 * confirm in the page, and for a phone by wire that a tools page watches, CDP over adb forward and
 * the wired telemetry (GPU, CPU and memory per process, JS heap and inferred GCs) published as
 * `editor.deviceTelemetry` once a second. Registers the editor methods `connect.*` on the hub;
 * hooks the hub's `hub:device`; emits its per-plugin event `connect:telemetry`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createServerPlugin } from "../../config";
import { hubPlugin } from "../hub";
import { createConnectApi } from "./api";
import { createConnectHooks } from "./handlers";
import { initConnect } from "./init";
import { startConnect, stopConnect } from "./lifecycle";
import { createConnectState } from "./state";
import type { ConnectConfig, DeviceTelemetry } from "./types";

const defaultConfig: ConnectConfig = {
  adb: "adb",
  adbTimeoutMs: 5000,
  scanEveryMs: 2000,
  answerTimeoutMs: 20_000,
  leaseMs: 10_000,
  telemetryEveryMs: 1000,
  meminfoEveryMs: 5000,
  heapEveryMs: 250,
  gcDropMb: 0.5,
  gcTrace: false,
  wire: "manual"
};

/**
 * Connect plugin — connect a phone from the tools page: device mode on request, the device
 * directory, the pairing confirm in the page, and wired telemetry (GPU, CPU, memory, JS heap over
 * CDP) for a phone by wire.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { connect: { wire: "auto" } } });
 * await editor.start();
 * editor.connect.directory().mode; // { on: true, owner: "connect", listen: { port: 47600, adb: "127.0.0.1:47600", lan: null } } when adb answered
 * ```
 */
export const connectPlugin = createServerPlugin("connect", {
  depends: [hubPlugin],
  config: defaultConfig,
  events: (register: RegisterFunction) => ({
    "connect:telemetry": register<DeviceTelemetry>(
      "One wired telemetry record of a watched device, once per tick"
    )
  }),
  createState: createConnectState,
  api: createConnectApi,
  hooks: createConnectHooks,
  onInit: initConnect,
  // @no-resource-check — onStart: auto wire only; timers, adb children, CDP sockets and forwards start in the editor methods; onStop frees them
  onStart: startConnect,
  onStop: stopConnect
});
