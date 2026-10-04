/**
 * Complex tier — the editor's websocket switchboard: token + Origin/Host checks before upgrade,
 * one websocket handler (agent, tools), sessions, routing, pending calls, fan-out, published
 * server state, serve().
 * Emits the global server event `hub:session`.
 *
 * @see README.md
 */
import { createServerPlugin } from "../../config";
import { filesPlugin } from "../files";
import { createHubApi } from "./api";
import { validateHubConfig } from "./init";
import { startHub, stopHub } from "./lifecycle";
import { createHubState } from "./state";
import type { HubConfig } from "./types";

const defaultConfig: HubConfig = {
  path: "/__editor",
  allow: [],
  callTimeoutMs: 5000,
  silentAfterMs: 6000
};

/**
 * Hub plugin — connects game pages (agent) and tools pages over one websocket handler.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { files: { root: "." } } });
 * await editor.start();
 * Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index } }));
 * ```
 */
export const hubPlugin = createServerPlugin("hub", {
  depends: [filesPlugin],
  config: defaultConfig,
  createState: createHubState,
  api: createHubApi,
  onInit: validateHubConfig,
  // @no-resource-check — onStart creates the token and the silent interval; onStop closes sockets and timers
  onStart: startHub,
  onStop: stopHub
});
