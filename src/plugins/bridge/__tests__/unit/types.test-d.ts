import { expectTypeOf } from "vitest";
import type { AgentEvents } from "../../../../config";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { channelPlugin } from "../../../channel";
import type { DeviceLink } from "../../../hub/protocol";
import { perfPlugin } from "../../../perf";
import { recorderPlugin } from "../../../recorder";
import type { RecorderStatusEvent } from "../../../recorder/types";
import { registryPlugin } from "../../../registry";
import type { LinkStatus } from "../../../registry/protocol";
import { bridgePlugin } from "../..";
import type { BridgeCtx, BridgeHooks } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Type level (checked by tsc, the file is not run): the bridge:status payload
// with its link, the app surface, the device config, the hook of the
// recorder's per-plugin event.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, perfPlugin, recorderPlugin]
});

/**
 * The bridge's emit takes a link with a known mode and refuses another.
 *
 * @param emit - The bridge's emit.
 * @param status - A link status.
 */
export function emitsLink(emit: BridgeCtx["emit"], status: LinkStatus): void {
  emit("bridge:status", { status, link: { mode: "adb", address: "127.0.0.1:47600" } });
  // @ts-expect-error -- "wifi" is not a link mode
  emit("bridge:status", { status, link: { mode: "wifi", address: "127.0.0.1:47600" } });
}

expectTypeOf<AgentEvents["bridge:status"]["link"]>().toEqualTypeOf<DeviceLink | undefined>();

/**
 * The app surface and the device config.
 */
export function appSurface(): void {
  const app = framework.createApp({
    plugins: [bridgePlugin],
    pluginConfigs: { bridge: { device: "192.168.1.5:47600" } }
  });
  expectTypeOf(app.bridge.link).returns.toEqualTypeOf<DeviceLink | undefined>();
  expectTypeOf(app.bridge.connect).parameter(0).toEqualTypeOf<string>();

  framework.createApp({
    plugins: [bridgePlugin],
    pluginConfigs: { bridge: { device: undefined } }
  });
  // @ts-expect-error -- device is a host:port string, not a port number
  framework.createApp({ plugins: [bridgePlugin], pluginConfigs: { bridge: { device: 47_600 } } });
}

expectTypeOf<Parameters<BridgeHooks["recorder:status"]>[0]>().toEqualTypeOf<RecorderStatusEvent>();
