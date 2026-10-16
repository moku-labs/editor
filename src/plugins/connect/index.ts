/**
 * Complex tier — connect a phone from the tools page: device mode on request, the device directory,
 * the pairing confirm in the page, CDP and the wired telemetry of a phone by wire (spec 11 § 3).
 * Skeleton of build wave 0: the config is final; the editor methods, the api, the `hub:device` hook
 * and the per-plugin event `connect:telemetry` land in build wave 2.
 *
 * @see README.md
 */
import { createServerPlugin } from "../../config";
import { hubPlugin } from "../hub";
import type { ConnectConfig } from "./types";

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
 * const editor = createApp({ pluginConfigs: { connect: { adb: "/opt/android/platform-tools/adb" } } });
 * await editor.start();
 * ```
 */
export const connectPlugin = createServerPlugin("connect", {
  // hub: the device listeners, the editor methods and `hub:device` (wave 2); the order is checked now.
  depends: [hubPlugin],
  config: defaultConfig
});
