/**
 * Complex tier — the performance read model of the page agent: reads the engine monitor's frame ring
 * into a 6 s window, ranks spike causes and serves the editor.perf.* sources. Wave 0 stub: the config
 * and the dependency on the registry only; unit 03 wires the state, api and lifecycle.
 */
import { createAgentPlugin } from "../../config";
import { registryPlugin } from "../registry";
import type { PerfConfig } from "./types";

const defaultConfig: PerfConfig = { readEveryMs: 250, windowMs: 6000, frames: 1024 };

/**
 * The perf plugin, a default of the agent core.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { registry: { game }, perf: { windowMs: 10_000 } } });
 * ```
 */
export const perfPlugin = /* @__PURE__ */ createAgentPlugin("perf", {
  // The stub keeps the spec's edge so the composition order is checked from wave 0 on.
  depends: [registryPlugin],
  config: defaultConfig
});
