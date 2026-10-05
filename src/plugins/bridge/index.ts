/**
 * Complex tier — opt-in, dev only. Websocket client from the game page to the editor hub: hello,
 * JSON-RPC dispatch into the channel, value and heartbeat pushes, reconnect with backoff, bye on
 * stop, the game checkpoint across Bun's full reload and the editor.reload command. Emits the
 * global agent event `bridge:status`.
 *
 * @see README.md
 */
import { createAgentPlugin } from "../../config";
import { channelPlugin } from "../channel";
import { registryPlugin } from "../registry";
import { createBridgeApi } from "./api";
import { initBridge, startBridge, stopBridge } from "./lifecycle";
import { createBridgeState } from "./state";
import type { BridgeConfig } from "./types";
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_RETRY_MS } from "./types";

const defaultConfig: BridgeConfig = {
  hello: "/__editor/hello",
  retryMs: DEFAULT_RETRY_MS,
  callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS
};

/**
 * The dev bridge between the game page and the editor server.
 *
 * @example
 * ```ts
 * const editor = createApp({ plugins: [bridgePlugin], pluginConfigs: { registry: { game } } });
 * await editor.start();
 * editor.bridge.status(); // { kind: "connecting" } → { kind: "live", frame: 12 }
 * ```
 */
export const bridgePlugin = /* @__PURE__ */ createAgentPlugin("bridge", {
  depends: [registryPlugin, channelPlugin],
  config: defaultConfig,
  createState: createBridgeState,
  api: createBridgeApi,
  onInit: initBridge,
  // @no-resource-check — onStart opens the socket and listeners; onStop says bye and closes them
  onStart: startBridge,
  onStop: stopBridge
});
