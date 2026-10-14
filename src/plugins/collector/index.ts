/**
 * Complex tier — device logs on the computer: one JSONL file per phone log (every line stamped
 * with `rx`, a reconnect appends to the same file), adb reverse, heat and system frames while
 * device mode is on, the computer mark route `{path}/perf/mark`, and the runtime-free `report/`.
 * Idle until the hub's `hub:device`. Emits its per-plugin event `collector:session`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createServerPlugin } from "../../config";
import { filesPlugin } from "../files";
import { hubPlugin } from "../hub";
import { createCollectorApi } from "./api";
import { createCollectorHooks } from "./handlers";
import { initCollector } from "./init";
import { stopCollector } from "./lifecycle";
import { createCollectorState } from "./state";
import type { CollectorConfig, CollectorSessionEvent } from "./types";

const defaultConfig: CollectorConfig = {
  out: ".moku/perf",
  everyS: 10,
  reverseEveryMs: 2000,
  adb: "adb",
  adbTimeoutMs: 5000,
  appId: undefined
};

/**
 * Collector plugin — device logs on the computer: one JSONL file per phone log, adb reverse and
 * heat while device mode is on, `collector:session` for live lines. Idle until `hub:device`.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { collector: { out: "logs/perf" } } });
 * ```
 */
export const collectorPlugin = createServerPlugin("collector", {
  depends: [filesPlugin, hubPlugin],
  config: defaultConfig,
  events: (register: RegisterFunction) => ({
    "collector:session": register<CollectorSessionEvent>(
      "A device log opened, grew, left or finished"
    )
  }),
  createState: createCollectorState,
  api: createCollectorApi,
  hooks: createCollectorHooks,
  onInit: initCollector,
  // @no-resource-check — timers and file handles start in the hub:device hook; onStop frees them
  onStop: stopCollector
});
