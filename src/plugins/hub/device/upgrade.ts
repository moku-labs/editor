/**
 * @file hub plugin — the `{path}/ws` route of the device listeners (C3). In order: the path, a
 * started hub with device mode on, the upgrade header, the listener rule (a tools socket only on
 * the adb listener, through the normal upgrade's checks; never on the LAN), `kind=agent
 * role=device`, the Host of this listener, a device Origin, and the credentials: a device id and
 * token of this run make a paired socket, a stale pair an unpaired one (closed 4401 at open), none
 * a pairing socket unless the peer address cools down after a refusal. Every refusal is logged once
 * with the normal `hub:refused` line, never the URL or a token.
 */
import type { DeviceLinkKind } from "../protocol";
import { allowedHosts } from "../security/guard";
import { sameToken } from "../security/token";
import type { UpgradeCheck } from "../security/upgrade";
import { handleUpgrade, refused } from "../security/upgrade";
import type { HubCtx, HubServer, HubSocketData, HubState } from "../types";

/**
 * The device part of the socket data a device upgrade makes.
 */
type DeviceData = NonNullable<HubSocketData["device"]>;

/**
 * The address of a peer Bun does not report.
 */
const UNKNOWN_ADDRESS = "unknown";

/**
 * The first failing check before the listener rule: path, started with device mode on, upgrade.
 *
 * @param ctx - Domain context of the hub.
 * @param req - The request.
 * @param url - The parsed request URL.
 * @returns The failing check, or undefined.
 */
function precheck(ctx: HubCtx, req: Request, url: URL): UpgradeCheck | undefined {
  if (url.pathname !== `${ctx.config.path}/ws`) return "path";
  if (ctx.state.token === undefined || ctx.state.deviceListen === undefined) return "started";
  if (req.method !== "GET" || req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return "upgrade";
  }
  return undefined;
}

/**
 * True for the Host this listener answers to: a loopback Host of its port on the adb listener,
 * exactly `<lan address>:<port>` (IPv6 in brackets) on the LAN listener (no DNS rebinding).
 *
 * @param state - Hub state.
 * @param req - The request.
 * @param server - The listener.
 * @param link - Which listener.
 * @returns Whether the Host is allowed.
 */
function isListenerHost(
  state: HubState,
  req: Request,
  server: HubServer,
  link: DeviceLinkKind
): boolean {
  const host = req.headers.get("host")?.toLowerCase();
  if (host === undefined || server.port === undefined) return false;

  return link === "adb" ? allowedHosts(server.port).has(host) : host === state.deviceListen?.lan;
}

/**
 * True for a device Origin: present, lower-cased, in `state.deviceOrigins`; `null` never is.
 *
 * @param state - Hub state.
 * @param req - The request.
 * @returns Whether the Origin is a device's.
 */
function isDeviceOrigin(state: HubState, req: Request): boolean {
  const origin = req.headers.get("origin")?.toLowerCase();

  return origin !== undefined && origin !== "null" && state.deviceOrigins.has(origin);
}

/**
 * The device data of the credentials, or the failing check: both `device` and `token` give a
 * paired socket when they name a record of this run (timing-safe compare), else an unpaired one;
 * none gives a pairing socket unless the address cools down; only one of the two is refused.
 *
 * @param state - Hub state.
 * @param url - The parsed request URL.
 * @param device - The link and the peer address.
 * @param device.link - Which listener.
 * @param device.address - The peer address.
 * @returns The device data, or "credentials" / "cooldown".
 */
function credentialsOf(
  state: HubState,
  url: URL,
  device: { readonly link: DeviceLinkKind; readonly address: string }
): DeviceData | UpgradeCheck {
  const id = url.searchParams.get("device");
  const token = url.searchParams.get("token");
  if (id !== null && token !== null) {
    const record = state.devices.get(id);
    const known = record !== undefined && sameToken(token, record.token);
    return known ? { ...device, id } : { ...device, unpaired: true };
  }
  if (id !== null || token !== null) return "credentials";

  const until = state.pairing.cooldown.get(device.address);
  if (until === undefined) return device;
  if (until > Date.now()) return "cooldown";

  state.pairing.cooldown.delete(device.address);
  return device;
}

/**
 * The device listeners' `{path}/ws` handler: undefined after an upgrade (Bun contract), else the
 * refusal (404 path, 503 device mode off, 426 not an upgrade, 403 listener / Host / Origin, 400
 * kind / role / credentials / a failed upgrade, 429 cooldown). A `kind=tools` upgrade on the adb
 * listener runs the normal upgrade's checks (the tools page is served there too).
 *
 * @param ctx - Domain context of the hub.
 * @param req - The request.
 * @param server - The listener.
 * @param link - "adb" on the loopback listener, "lan" on the LAN listener.
 * @returns undefined when upgraded, else the refusal.
 */
export function handleDeviceUpgrade(
  ctx: HubCtx,
  req: Request,
  server: HubServer,
  link: DeviceLinkKind
): Response | undefined {
  const url = new URL(req.url, "http://127.0.0.1");
  const failed = precheck(ctx, req, url);
  if (failed !== undefined) return refused(ctx, req, failed);

  const kind = url.searchParams.get("kind");
  if (kind === "tools") {
    return link === "adb" ? handleUpgrade(ctx, req, server) : refused(ctx, req, "listener");
  }
  if (kind !== "agent") return refused(ctx, req, "kind");
  if (url.searchParams.get("role") !== "device") return refused(ctx, req, "role");

  const { state } = ctx;
  if (!isListenerHost(state, req, server, link)) return refused(ctx, req, "host");
  if (!isDeviceOrigin(state, req)) return refused(ctx, req, "origin");

  const address = server.requestIP?.(req)?.address ?? UNKNOWN_ADDRESS;
  const device = credentialsOf(state, url, { link, address });
  if (typeof device === "string") return refused(ctx, req, device);

  const conn = state.nextConn;
  state.nextConn += 1;
  const data: HubSocketData = { kind: "agent", conn, device };
  return server.upgrade(req, { data }) ? undefined : refused(ctx, req, "failed");
}
