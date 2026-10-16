/**
 * Complex tier — the editor's window over the game: hidden, pill or card; drag, snap and the safe
 * area; tabs Frames (graph, counters, spike record), Game (the game's overlay commands), Record and
 * Link. Paints on its own 4 Hz tick inside the engine's agent bracket. Sets
 * globalThis.__MOKU_GAME_OVERLAY__ for app.debug.overlay. Emits overlay:changed and
 * overlay:connect; hooks bridge:status and recorder:status.
 *
 * @see README.md
 */
import { createAgentPlugin } from "../../config";
import { channelPlugin } from "../channel";
import { perfPlugin } from "../perf";
import { recorderPlugin } from "../recorder";
import { registryPlugin } from "../registry";
import { createOverlayApi } from "./api";
import { createHandlers } from "./handlers";
import { initOverlay, startOverlay, stopOverlay } from "./lifecycle";
import { createOverlayState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { mode: "hidden", dock: "right", remember: true, mount: undefined };

/**
 * The overlay plugin, a default of the agent core.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { registry: { game }, overlay: { mode: "pill" } } });
 * await editor.start(); // the pill shows fps and the spikes of the last 6 s
 * ```
 */
export const overlayPlugin = /* @__PURE__ */ createAgentPlugin("overlay", {
  depends: [registryPlugin, channelPlugin, perfPlugin, recorderPlugin],
  config: defaultConfig,
  createState: createOverlayState,
  api: createOverlayApi,
  hooks: createHandlers,
  onInit: initOverlay,
  // @no-resource-check — onStart mounts the host, listeners, observers, the global and the tick; onStop removes them
  onStart: startOverlay,
  onStop: stopOverlay
});
