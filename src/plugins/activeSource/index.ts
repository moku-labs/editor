/**
 * Standard tier — one source per tools page: the local preview or a device session. Switching
 * pauses the local preview while a device is the source and resumes it after; the Connect panel's
 * actions, the telemetry lease, the disconnect notice and the timeline markers (spec 11 § 4).
 * Emits the per-plugin events `activeSource:changed` and `activeSource:connect-requested`.
 * Skeleton of build wave 0: config, events and the typed api stub are final in shape; the api, the
 * `link:status` hook and the lifecycle land in build wave 2.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { createActiveSourceApi } from "./api";
import type { ActiveSourceConfig, ConnectRequest, SourceChange } from "./types";

const defaultConfig: ActiveSourceConfig = {
  autoUse: true,
  pauseLocal: true,
  rejoinMs: 15_000,
  noticeMs: 12_000,
  renewMs: 4000,
  markers: 32
};

/**
 * activeSource plugin — one source per tools page: the local preview or a device. Switching pauses
 * the local preview while a device is the source and resumes it after.
 *
 * @example
 * ```ts
 * const app = createApp({});
 * await app.start();
 * app.activeSource.current(); // { kind: "local", session: "s-1" }
 * ```
 */
export const activeSourcePlugin = createToolsPlugin("activeSource", {
  // link: sessions, the choice, runIn and callEditor (wave 2); the order is checked now.
  depends: [linkPlugin],
  config: defaultConfig,
  events: (register: RegisterFunction) => ({
    "activeSource:changed": register<SourceChange>(
      "The page's source changed: local preview, a device or another page"
    ),
    "activeSource:connect-requested": register<ConnectRequest>("Open the Connect panel")
  }),
  api: createActiveSourceApi
});
