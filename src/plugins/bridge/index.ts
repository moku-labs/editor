/**
 * Complex tier — opt-in. Websocket client from the game page to the editor hub. Page mode: hello,
 * JSON-RPC dispatch into the channel, heartbeats, taps, the checkpoint across Bun's full reload,
 * editor.reload and editor.clock. Device mode: dials a computer address, pairs by a code, ships the
 * recorder's log with an ack. Emits the global agent event `bridge:status`; hooks
 * `overlay:connect` and `recorder:status`.
 *
 * @see README.md
 */
import { createAgentPlugin } from "../../config";
import { channelPlugin } from "../channel";
import { recorderPlugin } from "../recorder";
import { registryPlugin } from "../registry";
import { createBridgeApi } from "./api";
import { createBridgeHooks } from "./handlers";
import { initBridge, startBridge, stopBridge } from "./lifecycle";
import { createBridgeState } from "./state";
import type { BridgeConfig } from "./types";
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_LINES_PER_BATCH, DEFAULT_RETRY_MS } from "./types";

const defaultConfig: BridgeConfig = {
  hello: "/__editor/hello",
  retryMs: DEFAULT_RETRY_MS,
  callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS,
  device: undefined,
  linesPerBatch: DEFAULT_LINES_PER_BATCH
};

/**
 * The bridge between the game page and the editor server, on a dev page or a phone.
 *
 * @example
 * ```ts
 * const editor = createApp({ plugins: [bridgePlugin], pluginConfigs: { registry: { game } } });
 * await editor.start();
 * editor.bridge.link(); // { mode: "connecting", address: "127.0.0.1:47600", pairing: { code: "4821" } } on a phone
 * ```
 */
export const bridgePlugin = /* @__PURE__ */ createAgentPlugin("bridge", {
  depends: [registryPlugin, channelPlugin, recorderPlugin],
  config: defaultConfig,
  createState: createBridgeState,
  api: createBridgeApi,
  hooks: createBridgeHooks,
  onInit: initBridge,
  // @no-resource-check — onStart opens the socket and listeners; onStop says bye and closes them
  onStart: startBridge,
  onStop: stopBridge
});
