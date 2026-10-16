/**
 * Complex tier — the editor's websocket switchboard: token + Origin/Host checks before upgrade,
 * one websocket handler (agent, tools, device), sessions, routing, pending calls, fan-out,
 * published server state (the computer's engine among it), serve(), editor methods of other
 * server plugins, the `from` / `client` stamp of a tools run, and device mode (the device
 * listeners, the LAN listener on and off, pairing, the link ping, the device's perf log batches).
 * Emits the global server event `hub:session` and its own event `hub:device`; hooks
 * `files:project` (published as `editor.project`).
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createServerPlugin } from "../../config";
import { filesPlugin } from "../files";
import { createHubApi } from "./api";
import { createHandlers } from "./handlers";
import { validateHubConfig } from "./init";
import { startHub, stopHub } from "./lifecycle";
import { createHubState } from "./state";
import type { HubConfig, HubDeviceEvent } from "./types";

const defaultConfig: HubConfig = {
  path: "/__editor",
  allowOrigins: [],
  callTimeoutMs: 5000,
  silentAfterMs: 6000,
  devicePort: 47_600,
  deviceLan: false,
  lanAddress: undefined,
  deviceOrigins: ["tauri://localhost", "https://tauri.localhost", "http://tauri.localhost"],
  pairing: "lan",
  pairTimeoutMs: 60_000
};

/**
 * Hub plugin — connects game pages and phones (agent) and tools pages over one websocket handler.
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
  events: (register: RegisterFunction) => ({
    "hub:device": register<HubDeviceEvent>(
      "Device mode: listening, a device connected, a log batch, a device left, stopped"
    )
  }),
  createState: createHubState,
  api: createHubApi,
  hooks: createHandlers,
  onInit: validateHubConfig,
  // @no-resource-check — onStart: token, silent interval, engine; onStop: sockets, timers, device listeners
  onStart: startHub,
  onStop: stopHub
});
