/**
 * Standard tier — the in-process EditorChannel of the game page: read now, watch with an immediate
 * first value, run in a microtask off the frame loop, heartbeat on setInterval. Emits no events.
 *
 * @see README.md
 */
import { createAgentPlugin } from "../../config";
import { registryPlugin } from "../registry";
import { createChannelApi } from "./api";
import { checkConfig, startHeartbeat, stopChannel } from "./heartbeat";
import { createChannelState } from "./state";
import type { ChannelConfig } from "./types";

const defaultConfig: ChannelConfig = { heartbeatMs: 1000 };

/**
 * The agent channel the overlay and the bridge use.
 *
 * @example
 * ```ts
 * const stop = editor.channel.watch("game.position", undefined, position => show(position));
 * await editor.channel.run("game.step", { frames: 1 });
 * ```
 */
export const channelPlugin = createAgentPlugin("channel", {
  depends: [registryPlugin],
  config: defaultConfig,
  createState: createChannelState,
  api: createChannelApi,
  onInit: checkConfig,
  // @no-resource-check — onStart starts the heartbeat interval; onStop clears it and closes every watch
  onStart: startHeartbeat,
  onStop: stopChannel
});
