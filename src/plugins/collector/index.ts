/**
 * Complex tier — device logs on the computer: one JSONL file per phone log, adb reverse and heat
 * while device mode is on, live lines for the perf CLI. Idle until hub:device. Wave 0 stub: the config
 * and the dependencies on files and the hub only; unit 04 wires the rest and its collector:session.
 */
import { createServerPlugin } from "../../config";
import { filesPlugin } from "../files";
import { hubPlugin } from "../hub";
import type { CollectorConfig } from "./types";

const defaultConfig: CollectorConfig = {
  out: ".moku/perf",
  everyS: 10,
  reverseEveryMs: 2000,
  adb: "adb",
  adbTimeoutMs: 5000,
  appId: undefined
};

/**
 * The collector plugin, a default of the server core.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { collector: { out: "logs/perf" } } });
 * ```
 */
export const collectorPlugin = createServerPlugin("collector", {
  // The stub keeps the spec's edges so the composition order is checked from wave 0 on.
  depends: [filesPlugin, hubPlugin],
  config: defaultConfig
});
