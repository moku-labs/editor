// biome-ignore-all assist/source/organizeImports: sectioned entry (Framework API → Plugins → Types) is house style
/**
 * The `@moku-labs/editor/agent` entry: the agent core for the game page. Default plugins:
 * registry, channel, overlay. The bridge (websocket to the editor server) and capture
 * (screenshots) are opt-in: a game's dev entry adds them.
 *
 * Plugin options and their defaults, set through `pluginConfigs`:
 *
 * | Plugin | Option | Default |
 * |---|---|---|
 * | registry | game | undefined, required: the app the game made with createApp |
 * | registry | modules | [] |
 * | registry | name | undefined: document.title, then "game" |
 * | channel | heartbeatMs | 1000 |
 * | overlay | open | false |
 * | overlay | corner | "top-right" |
 * | overlay | mount | undefined: document.body |
 * | bridge | hello | "/__editor/hello" |
 * | bridge | retryMs | 1000 |
 * | bridge | callTimeoutMs | 5000 |
 * | capture | maxDurationMs | 20000 |
 * | capture | minIntervalMs | 16 |
 *
 * @file The game page entry: the agent core and its plugins.
 * @example
 * ```ts
 * const editor = createApp({
 *   plugins: __MOKU_GAME_DEV__ ? [bridgePlugin, capturePlugin] : [],
 *   pluginConfigs: { registry: { game: app, modules: [mergeDev], name: "merge-game 0.0.0" } }
 * });
 * await editor.start();
 * ```
 */
import { agentCoreConfig, createAgentCore } from "./config";
import { channelPlugin } from "./plugins/channel";
import { overlayPlugin } from "./plugins/overlay";
import { registryPlugin } from "./plugins/registry";

// Pure: a bundle that uses neither createApp nor createPlugin drops the agent core (and a game's
// production build, which reaches this entry only behind `if (__MOKU_GAME_DEV__)`, drops it all).
const framework = /* @__PURE__ */ createAgentCore(agentCoreConfig, {
  // Dependency order: channel and overlay require registry, overlay requires channel.
  plugins: [registryPlugin, channelPlugin, overlayPlugin]
});

// ─── Framework API ────────────────────────────────────────────
/**
 * Creates the editor agent of a game page. `bridgePlugin` and `capturePlugin` are opt-in.
 *
 * @example
 * ```ts
 * const editor = createApp({ plugins: [bridgePlugin], pluginConfigs: { registry: { game } } });
 * ```
 */
export const createApp = framework.createApp;

/**
 * Creates a plugin for the agent core, e.g. a game's own editor command.
 *
 * @example
 * ```ts
 * export const pingPlugin = createPlugin("ping", { depends: [registryPlugin], onInit: addPing });
 * ```
 */
export const createPlugin = framework.createPlugin;

// ─── Plugins ──────────────────────────────────────────────────
export { bridgePlugin } from "./plugins/bridge";
export { capturePlugin } from "./plugins/capture";
export { channelPlugin } from "./plugins/channel";
export { overlayPlugin } from "./plugins/overlay";
export { registryPlugin } from "./plugins/registry";

// ─── Plugin Types (namespace re-exports) ──────────────────────
export * as Bridge from "./plugins/bridge/types";
export * as Capture from "./plugins/capture/types";
export * as Channel from "./plugins/channel/types";
export * as Overlay from "./plugins/overlay/types";
export * as Registry from "./plugins/registry/types";
