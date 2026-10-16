/**
 * @file connect plugin — the api factory (`app.connect`): the directory built now, and the last
 * telemetry record of an attached device.
 */
import { currentDirectory } from "./directory";
import type { ConnectApi, ConnectCtx } from "./types";

/**
 * Builds the connect api over the plugin state and the hub.
 *
 * @param ctx - Domain context of connect.
 * @returns The connect api.
 */
export function createConnectApi(ctx: ConnectCtx): ConnectApi {
  return {
    directory: () => currentDirectory(ctx),
    telemetry: device => ctx.state.attaches.get(device)?.last
  };
}
