/**
 * Standard tier — opt-in screenshots for the editor: registers editor.capture, editor.series and
 * editor.seriesStop into the registry, built on the door command game.capture. Never captures on
 * its own. Emits no events.
 *
 * @see README.md
 */
import { createAgentPlugin } from "../../config";
import { registryPlugin } from "../registry";
import { initCapture, stopCapture } from "./lifecycle";
import { createCaptureState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { maxDurationMs: 20_000, minIntervalMs: 16 };

/**
 * The capture plugin, added by a game's dev entry next to the bridge.
 *
 * @example
 * ```ts
 * const editor = createApp({ plugins: [bridgePlugin, capturePlugin], pluginConfigs: { registry: { game } } });
 * ```
 */
export const capturePlugin = createAgentPlugin("capture", {
  depends: [registryPlugin],
  config: defaultConfig,
  createState: createCaptureState,
  onInit: initCapture,
  // @no-resource-check — onStop clears the wait timer of a running series (spec/08 §2)
  onStop: stopCapture
});
