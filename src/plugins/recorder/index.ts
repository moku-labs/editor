/**
 * Complex tier — the performance log on the device: subscribes to the engine monitor's stream, stores
 * logs (OPFS or memory), shares them and keeps the outbox the bridge pulls. Wave 0 stub: the config
 * and the dependencies on the registry and perf only; unit 05 wires the rest and its recorder:status.
 */
import { createAgentPlugin } from "../../config";
import { perfPlugin } from "../perf";
import { registryPlugin } from "../registry";
import type { RecorderConfig } from "./types";

const defaultConfig: RecorderConfig = {
  autoStart: true,
  keepMb: 64,
  flushEveryMs: 1000,
  persistEveryMs: 5000,
  storage: "auto",
  keepFiles: 10
};

/**
 * The recorder plugin, a default of the agent core.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { registry: { game }, recorder: { autoStart: false } } });
 * ```
 */
export const recorderPlugin = /* @__PURE__ */ createAgentPlugin("recorder", {
  // The stub keeps the spec's edges so the composition order is checked from wave 0 on.
  depends: [registryPlugin, perfPlugin],
  config: defaultConfig
});
