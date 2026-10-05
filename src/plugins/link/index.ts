/**
 * Complex tier — the tools page's link to the editor server: boot JSON, websocket, sessions,
 * manifest cache, the remote EditorChannel, the hot reload state, the editor page's selection and
 * select handler, and the files client. Emits the global `link:status`.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { createLinkApi } from "./api";
import { checkLinkConfig, startLink, stopLink } from "./lifecycle";
import { createLinkState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  retryMs: 1000,
  boot: "#moku-editor-boot",
  role: "page",
  reloadGraceMs: 5000
};

/**
 * The link plugin: one websocket to the hub and the remote EditorChannel every panel reads.
 *
 * @example
 * ```ts
 * const app = createApp({});
 * await app.start();
 * app.link.watch("game.position", undefined, position => show(position));
 * ```
 */
export const linkPlugin = createToolsPlugin("link", {
  config: defaultConfig,
  createState: createLinkState,
  api: createLinkApi,
  onInit: checkLinkConfig,
  // @no-resource-check — onStart opens the websocket and the silence interval; onStop closes them
  onStart: startLink,
  onStop: stopLink
});
