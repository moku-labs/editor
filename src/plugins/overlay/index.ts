/**
 * Standard tier — the in-game overlay: render numbers and the game's cheat commands in a small
 * card over the game page. Off by default; switched by editor.overlay or config open. Hooks the
 * global bridge:status for its link dot. Emits no events.
 *
 * @see README.md
 */
import { createAgentPlugin } from "../../config";
import { channelPlugin } from "../channel";
import { registryPlugin } from "../registry";
import { createOverlayApi } from "./api";
import { initOverlay } from "./command";
import { createHandlers } from "./handlers";
import { startOverlay, unmountOverlay } from "./mount";
import { createOverlayState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { open: false, corner: "top-right", mount: undefined };

/**
 * The overlay plugin, a default of the agent core.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { registry: { game }, overlay: { open: true } } });
 * await editor.start(); // QA build: the card shows fps and the cheats
 * ```
 */
export const overlayPlugin = /* @__PURE__ */ createAgentPlugin("overlay", {
  depends: [registryPlugin, channelPlugin],
  config: defaultConfig,
  createState: createOverlayState,
  api: createOverlayApi,
  hooks: createHandlers,
  onInit: initOverlay,
  // @no-resource-check — onStart mounts the DOM host and listener; onStop removes them and the interval
  onStart: startOverlay,
  onStop: unmountOverlay
});
