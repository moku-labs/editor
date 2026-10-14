/**
 * @file hub plugin — device mode on and off (C2). `listenDevices` starts the loopback listener
 * (the editor routes, the tools page and the device socket on `127.0.0.1:<devicePort>`) and, with
 * `deviceLan`, the LAN listener on the same port with the device socket only. `stopDevices`
 * announces each connected device `closed` (`stopped`), runs the state-only `teardownDevices` and
 * announces `stopped`. `teardownDevices` is the half that `onStop` shares: it takes the state only,
 * so it can neither log nor emit.
 */
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import type { DeviceLinkKind } from "../protocol";
import { isEditorKey, notFound } from "../serve";
import type {
  BunServeOptions,
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
import { abortAllPairings, clearPairDeadline } from "./pairing";
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
 * Close code of the device connections when device mode goes off.
 */
const GOING_AWAY = 1001;

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
  // The one cast of device mode, as in serve.ts: Bun types routes, fetch and websocket as an XOR of
  // option shapes, and an upgrading route returns undefined.
  serve: options => Bun.serve(options as unknown as BunServeOptions),
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
 * The LAN address device mode binds: none without deviceLan, else config.lanAddress or the picked
 * address of a Wi-Fi or wired card.
 *
 * @param ctx - Domain context of the hub.
 * @param deps - The runtime deps.
 * @returns The address, or undefined without deviceLan.
 * @throws {Error} When deviceLan is on and no LAN address is found.
 */
function lanAddress(ctx: HubCtx, deps: DeviceDeps): string | undefined {
  const { deviceLan, lanAddress: configured } = ctx.config;
  if (!deviceLan) return undefined;

  const address = configured ?? lanAddressOf(deps.interfaces());
  if (address !== undefined) return address;

  throw deviceError(
    "hub: --lan found no LAN address on this computer",
    "Connect to a Wi-Fi or set pluginConfigs.hub.lanAddress"
  );
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
      const lanRoutes = { [socketPath]: socketRoute(ctx, "lan") };
      lanServer = start(deps, {
        hostname: lan,
        port,
        routes: lanRoutes,
        fetch: notFound,
        websocket
      });
    } catch (error) {
      await stopAll([adb]);
      throw error;
    }
  }

  // eslint-disable-next-line unicorn/no-null -- null is "no LAN listener" on DeviceListen
  const lanText = lan === undefined ? null : `${hostOf(lan)}:${port}`.toLowerCase();
  const listen: DeviceListen = Object.freeze({ port, adb: `${LOOPBACK}:${port}`, lan: lanText });
  state.routesFrozen = true;
  state.deviceServers = { adb, lan: lanServer };
  state.deviceListen = listen;
  state.confirm = options.confirm;
  ctx.log.info("hub:devices-on", { port, lan: lanText });
  emitDevice(ctx, { kind: "listening", listen });
  return listen;
}

/**
 * The state-only half of device mode off, shared by `stopDevices` and `onStop` (C2). In order:
 * aborts every pending pairing, forgets the device records (tokens die with device mode, so the
 * close handlers of the sockets closed next find no record and announce nothing), closes every
 * device connection 1001 `device mode off`, clears the listeners, the answer of listenDevices and
 * the callback, and stops both listeners (at most 500 ms). It takes no ctx: it can neither log nor
 * emit. With device mode off it resolves at once.
 *
 * @param state - Hub state.
 * @returns When the listeners stopped.
 */
export async function teardownDevices(state: HubState): Promise<void> {
  const servers = state.deviceServers;
  if (servers === undefined) return;

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
