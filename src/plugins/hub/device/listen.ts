/**
 * @file hub plugin — device mode on and off (C2), and the LAN listener on and off while it runs
 * (spec 11 § 5.1 H1). `listenDevices` starts the loopback listener (the editor routes, the tools
 * page and the device socket on `127.0.0.1:<devicePort>`) and, with `deviceLan`, the LAN listener
 * on the same port with the device socket only, then the once-a-second device ping (H4).
 * `listenLan` adds the LAN listener later and `stopLan` removes it; the phones by wire stay.
 * `stopDevices` announces each connected device `closed` (`stopped`), runs the state-only
 * `teardownDevices` and announces `stopped`. `teardownDevices` is the half that `onStop` shares: it
 * takes the state only, so it can neither log nor emit.
 */
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import type { DeviceLinkKind } from "../protocol";
import { isEditorKey, notFound } from "../serve";
import type {
  AgentConn,
  BunServeOptions,
  DeviceConn,
  DeviceListen,
  DeviceListenOptions,
  DeviceServe,
  DeviceServeOptions,
  DeviceServer,
  HubCtx,
  HubServer,
  HubState,
  HubWebSocketHandler,
  RouteHandler
} from "../types";
import type { Interfaces } from "./lan";
import { lanAddressOf } from "./lan";
import { abortAllPairings, abortPairing, clearPairDeadline } from "./pairing";
import { startPings, stopPings } from "./ping";
import { emitDevice, linkedDevice } from "./records";
import { handleDeviceUpgrade } from "./upgrade";

/**
 * The longest wait for the device listeners to stop, in ms.
 */
export const DEVICE_STOP_MS = 500;

/**
 * The address of the adb listener (a phone reaches it through `adb reverse`).
 */
const LOOPBACK = "127.0.0.1";

/**
 * Close code of the device connections when device mode or the LAN listener goes off.
 */
const GOING_AWAY = 1001;

/**
 * Close reason of the LAN device connections when the LAN listener goes off.
 */
const LAN_OFF = "lan off";

/**
 * What device mode reads from the runtime: how a listener starts and the interface table.
 */
export type DeviceDeps = {
  readonly serve: DeviceServe;
  readonly interfaces: () => Interfaces;
};

/**
 * The runtime's device deps: `Bun.serve` and `os.networkInterfaces()`.
 */
const RUNTIME_DEPS: DeviceDeps = {
  // The one cast of device mode. DeviceServeOptions is the hub's structural seam (a fake in unit
  // tests, and no Bun namespace type in an exported shape, skeleton-conventions §3): its routes
  // are `unknown` values (the CLI's routes, the editor's handlers that answer undefined after an
  // upgrade) and its websocket is the hub's structural handler, so it is comparable with, but not
  // assignable to, Bun's XOR of option shapes. Bun.serve checks the route values at run time.
  serve: options => Bun.serve(options as BunServeOptions),
  interfaces: () => networkInterfaces()
};

/**
 * A device-mode error in the spec/11 Part 3 format with the editor prefix (R7).
 *
 * @param problem - What is wrong, without the final period.
 * @param fix - How to fix it, without the final period.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * deviceError("hub.listenDevices(): device mode is already on", "Call hub.stopDevices() first").message; // "[moku-editor] hub.listenDevices(): device mode is already on.\n  Call hub.stopDevices() first."
 * ```
 */
function deviceError(problem: string, fix: string): Error {
  return new Error(`[moku-editor] ${problem}.\n  ${fix}.`);
}

/**
 * The error of a taken port: two lines, and Bun's `code: "EADDRINUSE"` kept so the CLI can tell it.
 *
 * @param port - The port.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * portInUse(47600).code; // "EADDRINUSE"
 * ```
 */
function portInUse(port: number): Error & { readonly code: "EADDRINUSE" } {
  return Object.assign(
    deviceError(
      `port ${port} is in use`,
      `Is another moku-editor perf running? Try --port ${port + 1}`
    ),
    { code: "EADDRINUSE" as const }
  );
}

/**
 * True for an error Bun throws when the port is taken.
 *
 * @param error - What was thrown.
 * @returns Whether its code is EADDRINUSE.
 * @example
 * ```ts
 * isAddressInUse(Object.assign(new Error("Failed to start server"), { code: "EADDRINUSE" })); // true
 * ```
 */
function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

/**
 * Starts one listener; a taken port becomes the two-line port error.
 *
 * @param deps - The runtime deps.
 * @param options - The listener's options.
 * @returns The running listener.
 * @throws {Error} The port error, or what the runtime threw.
 */
function start(deps: DeviceDeps, options: DeviceServeOptions): DeviceServer {
  try {
    return deps.serve(options);
  } catch (error) {
    if (isAddressInUse(error)) throw portInUse(options.port);
    throw error;
  }
}

/**
 * Stops listeners and waits at most DEVICE_STOP_MS; a stop that fails is ignored.
 *
 * @param servers - The listeners.
 * @returns When they stopped or the wait ran out.
 */
async function stopAll(servers: readonly (DeviceServer | undefined)[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>(resolve => {
    timer = setTimeout(resolve, DEVICE_STOP_MS);
  });
  await Promise.race([Promise.allSettled(servers.map(server => server?.stop(true))), waited]);
  clearTimeout(timer);
}

/**
 * Checks the options: a function `confirm`, and extra routes outside the editor path only.
 *
 * @param ctx - Domain context of the hub.
 * @param options - The options of listenDevices.
 * @throws {TypeError} When `confirm` is not a function.
 * @throws {Error} On a route under the editor path.
 */
function checkOptions(ctx: HubCtx, options: DeviceListenOptions | undefined): void {
  if (typeof options?.confirm !== "function") {
    throw new TypeError(
      "[moku-editor] hub.listenDevices() needs options.confirm, the pairing callback.\n  Pass { confirm: (request, signal) => Promise<boolean> }."
    );
  }
  for (const key of Object.keys(options.routes ?? {})) {
    if (!isEditorKey(ctx.config.path, key)) continue;
    throw deviceError(
      `hub.listenDevices() refuses the route "${key}": it is under the editor path ${ctx.config.path}`,
      "Pass routes outside the editor path; the editor routes come from hub.addRoutes()"
    );
  }
}

/**
 * The LAN address to bind: config.lanAddress, else the picked address of a Wi-Fi or wired card.
 *
 * @param ctx - Domain context of the hub.
 * @param deps - The runtime deps.
 * @returns The address.
 * @throws {Error} When no LAN address is found.
 */
function resolveLan(ctx: HubCtx, deps: DeviceDeps): string {
  const address = ctx.config.lanAddress ?? lanAddressOf(deps.interfaces());
  if (address !== undefined) return address;

  throw deviceError(
    "hub: --lan found no LAN address on this computer",
    "Connect to a Wi-Fi or set pluginConfigs.hub.lanAddress"
  );
}

/**
 * The LAN address device mode binds at start: none without deviceLan, else `resolveLan`.
 *
 * @param ctx - Domain context of the hub.
 * @param deps - The runtime deps.
 * @returns The address, or undefined without deviceLan.
 * @throws {Error} When deviceLan is on and no LAN address is found.
 */
function lanAddress(ctx: HubCtx, deps: DeviceDeps): string | undefined {
  return ctx.config.deviceLan ? resolveLan(ctx, deps) : undefined;
}

/**
 * An address as the host part of `host:port`: IPv6 in brackets.
 *
 * @param address - An IP address.
 * @returns The host text.
 * @example
 * ```ts
 * hostOf("::1"); // "[::1]"
 * ```
 */
function hostOf(address: string): string {
  return isIP(address) === 6 ? `[${address}]` : address;
}

/**
 * The text of a LAN listener in DeviceListen, lower-cased: the Host check of the LAN listener
 * compares the exact text.
 *
 * @param address - The LAN address.
 * @param port - The real port.
 * @returns e.g. "192.168.1.5:47600" or "[fe80::1]:47600".
 * @example
 * ```ts
 * lanTextOf("FE80::1", 47600); // "[fe80::1]:47600"
 * ```
 */
function lanTextOf(address: string, port: number): string {
  return `${hostOf(address)}:${port}`.toLowerCase();
}

/**
 * The device socket route of a listener.
 *
 * @param ctx - Domain context of the hub.
 * @param link - Which listener.
 * @returns The route handler.
 */
function socketRoute(ctx: HubCtx, link: DeviceLinkKind): RouteHandler {
  return function upgrade(req: Request, server: HubServer): Response | undefined {
    return handleDeviceUpgrade(ctx, req, server, link);
  };
}

/**
 * Starts the LAN listener: `<address>:<port>` with `{path}/ws` only (bound to the LAN device
 * upgrade), a 404 fetch and the hub's one websocket handler.
 *
 * @param ctx - Domain context of the hub.
 * @param deps - The runtime deps.
 * @param where - The LAN address and the real port of the adb listener.
 * @param where.address - The LAN address.
 * @param where.port - The port.
 * @param websocket - The hub's websocket handler.
 * @returns The running listener.
 * @throws {Error} The port error, or what the runtime threw.
 */
function startLan(
  ctx: HubCtx,
  deps: DeviceDeps,
  where: { readonly address: string; readonly port: number },
  websocket: HubWebSocketHandler
): DeviceServer {
  return start(deps, {
    hostname: where.address,
    port: where.port,
    routes: { [`${ctx.config.path}/ws`]: socketRoute(ctx, "lan") },
    fetch: notFound,
    websocket
  });
}

/**
 * Turns device mode on (C2): the loopback listener on `127.0.0.1:<devicePort>` with the extra
 * routes, every editor route and `{path}/ws`; with a LAN address, the LAN listener on the same real
 * port with `{path}/ws` only. Both answer anything else 404 and share the hub's one websocket
 * handler. Freezes the editor routes, keeps the callback, logs `hub:devices-on` and emits
 * `listening`. A failing LAN listener stops the loopback one first.
 *
 * @param ctx - Domain context of the hub.
 * @param options - The pairing callback and the extra routes of the adb listener.
 * @param websocket - The hub's websocket handler.
 * @param deps - The runtime deps (fakes in unit tests).
 * @returns Where device mode listens.
 * @throws {TypeError} When `options.confirm` is not a function.
 * @throws {Error} Before start, when device mode is on, without a LAN address, on an editor route
 * in `options.routes`, and when the port is taken.
 */
export async function listenDevices(
  ctx: HubCtx,
  options: DeviceListenOptions,
  websocket: HubWebSocketHandler,
  deps: DeviceDeps = RUNTIME_DEPS
): Promise<DeviceListen> {
  checkOptions(ctx, options);
  const { state, config } = ctx;
  if (state.token === undefined) {
    throw deviceError(
      "hub.listenDevices() needs a started app",
      "Call it after await editor.start()"
    );
  }
  if (state.deviceServers !== undefined) {
    throw deviceError(
      "hub.listenDevices(): device mode is already on",
      "Call hub.stopDevices() first"
    );
  }

  const lan = lanAddress(ctx, deps);
  const socketPath = `${config.path}/ws`;
  const routes = { ...options.routes, ...Object.fromEntries(state.routes) };
  const adb = start(deps, {
    hostname: LOOPBACK,
    port: config.devicePort,
    routes: { ...routes, [socketPath]: socketRoute(ctx, "adb") },
    fetch: notFound,
    websocket
  });
  const port = adb.port ?? config.devicePort;

  let lanServer: DeviceServer | undefined;
  if (lan !== undefined) {
    try {
      lanServer = startLan(ctx, deps, { address: lan, port }, websocket);
    } catch (error) {
      await stopAll([adb]);
      throw error;
    }
  }

  // eslint-disable-next-line unicorn/no-null -- null is "no LAN listener" on DeviceListen
  const lanText = lan === undefined ? null : lanTextOf(lan, port);
  const listen: DeviceListen = Object.freeze({ port, adb: `${LOOPBACK}:${port}`, lan: lanText });
  state.routesFrozen = true;
  state.deviceServers = { adb, lan: lanServer };
  state.deviceListen = listen;
  state.confirm = options.confirm;
  startPings(state);
  ctx.log.info("hub:devices-on", { port, lan: lanText });
  emitDevice(ctx, { kind: "listening", listen });
  return listen;
}

/**
 * Adds the LAN listener while device mode runs (H1): the LAN address resolved as for deviceLan, on
 * the real port of the adb listener, device upgrades only. Sets `lan` on the listen, logs
 * `hub:devices-lan` and emits `listening`. With the LAN listener on already it starts nothing and
 * answers the current listen. Everything runs before the first await, so two calls at once start
 * one listener.
 *
 * @param ctx - Domain context of the hub.
 * @param websocket - The hub's websocket handler.
 * @param deps - The runtime deps (fakes in unit tests).
 * @returns Where device mode listens now.
 * @throws {Error} While device mode is off, without a LAN address, and when the port is taken.
 */
export async function listenLan(
  ctx: HubCtx,
  websocket: HubWebSocketHandler,
  deps: DeviceDeps = RUNTIME_DEPS
): Promise<DeviceListen> {
  const { state } = ctx;
  const servers = state.deviceServers;
  const current = state.deviceListen;
  if (servers === undefined || current === undefined) {
    throw deviceError("hub.listenLan() needs device mode", "Call hub.listenDevices() first");
  }
  if (servers.lan !== undefined) return current;

  const address = resolveLan(ctx, deps);
  servers.lan = startLan(ctx, deps, { address, port: current.port }, websocket);
  const listen: DeviceListen = Object.freeze({ ...current, lan: lanTextOf(address, current.port) });
  state.deviceListen = listen;
  ctx.log.info("hub:devices-lan", { lan: listen.lan });
  emitDevice(ctx, { kind: "listening", listen });
  return listen;
}

/**
 * Closes one LAN device connection with 1001 `lan off`. A paired one is announced `closed`
 * (`stopped`) now and its own close announces nothing more; its record stays (it may come back
 * with its token). A pairing one loses its question.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param device - Its device side, on the LAN listener.
 */
function closeLanConn(ctx: HubCtx, conn: AgentConn, device: DeviceConn): void {
  clearPairDeadline(device);
  if (device.id === undefined) {
    abortPairing(ctx, conn.conn);
  } else {
    const record = ctx.state.devices.get(device.id);
    if (record?.conn === conn.conn && !device.ended) {
      record.conn = undefined;
      device.ended = true;
      const stopped = linkedDevice(ctx.state, record, false);
      emitDevice(ctx, { kind: "closed", device: stopped, reason: "stopped" });
    }
  }
  conn.socket.close(GOING_AWAY, LAN_OFF);
}

/**
 * Removes the LAN listener (H1): every LAN device connection closes (`closeLanConn`), `lan`
 * becomes null, `hub:devices-lan` is logged and `listening` emitted, then the listener stops (at
 * most 500 ms). The adb listener and its phones stay. Without a LAN listener it does nothing.
 *
 * @param ctx - Domain context of the hub.
 * @returns When the LAN listener stopped.
 */
export async function stopLan(ctx: HubCtx): Promise<void> {
  const { state } = ctx;
  const servers = state.deviceServers;
  const current = state.deviceListen;
  const lanServer = servers?.lan;
  if (servers === undefined || current === undefined || lanServer === undefined) return;

  servers.lan = undefined;
  for (const conn of state.conns.values()) {
    if (conn.kind === "agent" && conn.device?.link === "lan") closeLanConn(ctx, conn, conn.device);
  }
  // eslint-disable-next-line unicorn/no-null -- null is "no LAN listener" on DeviceListen
  const listen: DeviceListen = Object.freeze({ ...current, lan: null });
  state.deviceListen = listen;
  ctx.log.info("hub:devices-lan", { lan: listen.lan });
  emitDevice(ctx, { kind: "listening", listen });
  await stopAll([lanServer]);
}

/**
 * The state-only half of device mode off, shared by `stopDevices` and `onStop` (C2). In order:
 * stops the device ping, aborts every pending pairing, forgets the device records (tokens die with device mode, so the
 * close handlers of the sockets closed next find no record and announce nothing), closes every
 * device connection 1001 `device mode off`, clears the listeners, the answer of listenDevices and
 * the callback, drops the held `deviceTelemetry` publish (H3), and stops both listeners (at most
 * 500 ms). It takes no ctx: it can neither log nor
 * emit. With device mode off it resolves at once.
 *
 * @param state - Hub state.
 * @returns When the listeners stopped.
 */
export async function teardownDevices(state: HubState): Promise<void> {
  const servers = state.deviceServers;
  if (servers === undefined) return;

  stopPings(state);
  abortAllPairings(state);
  state.devices.clear();
  for (const conn of state.conns.values()) {
    if (conn.kind === "agent" && conn.device !== undefined) {
      clearPairDeadline(conn.device);
      conn.socket.close(GOING_AWAY, "device mode off");
    }
  }
  state.deviceServers = undefined;
  state.deviceListen = undefined;
  state.confirm = undefined;
  // The wired telemetry of this run is never replayed to a tools page of a later one (H3).
  state.published.delete("deviceTelemetry");
  await stopAll([servers.adb, servers.lan]);
}

/**
 * Turns device mode off: each paired device with a connection is announced `closed` (`stopped`),
 * then `teardownDevices` runs, then `hub:devices-off` is logged and `stopped` emitted. A call while
 * device mode is off does nothing. The editor routes stay frozen.
 *
 * @param ctx - Domain context of the hub.
 * @returns When both listeners stopped.
 */
export async function stopDevices(ctx: HubCtx): Promise<void> {
  const { state } = ctx;
  if (state.deviceServers === undefined) return;

  for (const record of state.devices.values()) {
    if (record.conn === undefined) continue;
    emitDevice(ctx, {
      kind: "closed",
      device: linkedDevice(state, record, false),
      reason: "stopped"
    });
  }
  await teardownDevices(state);
  ctx.log.info("hub:devices-off", {});
  emitDevice(ctx, { kind: "stopped" });
}
