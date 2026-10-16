/**
 * Complex tier — the performance model of the page agent: reads the engine monitor's frame ring into
 * a 6 s window, ranks spike causes, keeps the newest log lines; serves the overlay through its api
 * and the tools page and MCP through the editor.perf.* sources, Mission control's feeds (frames,
 * events, passes, detail) and the `editor.perf.sections` command (feeds/). No DOM, no IO, no events.
 *
 * @see README.md
 */
import { createAgentPlugin } from "../../config";
import { registryPlugin } from "../registry";
import { createPerfApi } from "./api";
import { initPerf, startPerf, stopPerf } from "./lifecycle";
import { createPerfState } from "./state";
import type { PerfConfig } from "./types";

const defaultConfig: PerfConfig = {
  readEveryMs: 250,
  windowMs: 6000,
  frames: 1024,
  feedPasses: false,
  feedSystems: true,
  feedNodes: false
};

/**
 * The perf plugin, a default of the agent core.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { registry: { game: app } } });
 * await editor.start();
 * editor.perf.second().fps; // { loop: 60, drawn: 54 } on the phone
 * ```
 */
export const perfPlugin = /* @__PURE__ */ createAgentPlugin("perf", {
  depends: [registryPlugin],
  config: defaultConfig,
  createState: createPerfState,
  api: createPerfApi,
  onInit: initPerf,
  // @no-resource-check — onStart starts the read timer and the stream listener; onStop frees both
  onStart: startPerf,
  onStop: stopPerf
});
