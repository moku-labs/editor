/**
 * Complex tier — the performance log on the device: subscribes to the engine monitor's stream,
 * queues line references, serializes them on its own timer inside beginAgent/endAgent, stores logs
 * (OPFS or memory), shares them, and keeps an outbox the bridge pulls. Emits its per-plugin
 * recorder:status; hooks the global overlay:changed and registry's per-plugin registry:command.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createAgentPlugin } from "../../config";
import { perfPlugin } from "../perf";
import { registryPlugin } from "../registry";
import { createRecorderApi } from "./api";
import { createRecorderHooks } from "./handlers";
import { initRecorder, startRecorder, stopRecorder } from "./lifecycle";
import { createRecorderState } from "./state";
import type { RecorderConfig, RecorderStatusEvent } from "./types";

const defaultConfig: RecorderConfig = {
  autoStart: false,
  keepMb: 64,
  flushEveryMs: 1000,
  persistEveryMs: 5000,
  storage: "auto",
  keepFiles: 10,
  maxLogMb: 32
};

/**
 * The recorder plugin, a default of the agent core. Nothing is recorded until someone starts it:
 * the phone's Record tab, the tools page's Record button, or an agent (`editor.record`). Its event
 * `recorder:status` reaches the plugins that depend on it (the overlay, the bridge).
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { registry: { game: app } } });
 * await editor.start(); // nothing records yet
 * editor.recorder.start({ label: "boss run" }); // { name: "perf-20261014-1532-sm-a266b.jsonl", current: true, … }
 * editor.recorder.mark("boss enters"); // true
 * ```
 */
export const recorderPlugin = /* @__PURE__ */ createAgentPlugin("recorder", {
  depends: [registryPlugin, perfPlugin],
  config: defaultConfig,
  // `register` is typed so the own event is known before the pre-typed api and hooks are checked
  // (spec 14 §10 row 8).
  events: (register: RegisterFunction) => ({
    "recorder:status": register<RecorderStatusEvent>(
      "The device log started, stopped, exported, or its line counts moved"
    )
  }),
  createState: createRecorderState,
  api: createRecorderApi,
  hooks: createRecorderHooks,
  onInit: initRecorder,
  // @no-resource-check — onStart opens the store, subscribes the stream and starts the flush timer; onStop frees them
  onStart: startRecorder,
  onStop: stopRecorder
});
