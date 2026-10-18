/**
 * @file bridge plugin — the connection loop. Page mode: hello fetch, socket, `hello` first. Device
 * mode: the address's socket without a hello fetch, pairing or the remembered credentials, the
 * 4401 re-pair at once, a refusal that stops retrying. Both: the heartbeat tick, close and failure
 * handling with backoff, quiet while no computer answers. `connect` never throws and is never
 * awaited by onStart. The token is never logged: log lines name the hello origin and path, or the
 * device address.
 */
import { DEVICE_UNPAIRED_CODE, DEVICE_UNPAIRED_REASON } from "../../hub/protocol";
import type { Heartbeat, HelloBody } from "../../registry/protocol";
import { bareMessage } from "../../registry/protocol";
import { asError, handleText } from "../dispatch/dispatch";
import { dropInflight, flushPending, messageOf, NORMAL_CLOSE } from "../dispatch/send";
import { dropAll, sampleFrames } from "../dispatch/subscriptions";
import { dropShipping, shipNext } from "../lines";
import { noteSeen, setStatus } from "../status";
import type { BridgeDeps, SocketLike } from "../types";
import { DEFAULT_DEVICE_ADDRESS, PAIRING_REFUSED } from "../types";
import { deviceSocketUrl } from "./address";
import { nextDelay } from "./backoff";
import { credentialsOf, onUnpaired, rotateCandidate, startPairing } from "./device";
import { fetchHello, helloOrigin, resolveHelloUrl, socketUrl } from "./hello";
import { linkLabel, onLinked, sendBeat } from "./link";
import { hasNetwork, hasSocket } from "./socket";

export { sendBeat } from "./link";

/**
 * Close code of the bin's restart (1012, service restart): the hub closes every socket with it
 * before Bun's stop, so the loss is expected (U11).
 */
const SERVICE_RESTART = 1012;

/**
 * Close code of a policy refusal (1008): the hub's pairing refusals and timeouts.
 */
const POLICY_CLOSE = 1008;

/**
 * The channel heartbeat tick, active only while open: beat (even congested), status, backlog
 * flush, the frame-source sampling (R6), then the next log batch (device mode).
 *
 * @param deps - The domain deps.
 * @param beat - The beat of this tick.
 */
export function onBeat(deps: BridgeDeps, beat: Heartbeat): void {
  if (deps.state.phase !== "open") return;
  sendBeat(deps, beat);
  flushPending(deps);
  sampleFrames(deps);
  shipNext(deps);
}

/**
 * Socket open in page mode (and a credentialed device socket): the link step.
 *
 * @param deps - The domain deps.
 */
export function onOpen(deps: BridgeDeps): void {
  onLinked(deps);
}

/**
 * Logs a loss: the first failure of a streak once, the rest at debug (a game without an editor
 * server must not flood its log). The first is info `bridge:no-computer` in device mode before the
 * page ever linked, info for the bin's restart, warn otherwise.
 *
 * @param deps - The domain deps.
 * @param reason - The status reason.
 * @param retryInMs - The scheduled delay.
 * @param restarting - The editor closed the socket for its restart (1012).
 */
function logLoss(deps: BridgeDeps, reason: string, retryInMs: number, restarting: boolean): void {
  const { state, log } = deps;
  if (state.failureLogged) {
    log.debug("bridge:lost", { reason, retryInMs });
    return;
  }
  state.failureLogged = true;
  if (state.mode === "device" && !state.everLinked) {
    log.info("bridge:no-computer", { address: state.address, retryInMs });
  } else if (restarting) {
    log.info("bridge:lost", { reason, retryInMs });
  } else {
    log.warn("bridge:lost", { reason, retryInMs });
  }
}

/**
 * Forgets the socket and what lived on it: the session, every subscription, every request
 * deadline (late results are dropped) and the log batch in flight (its lines stay unsent).
 *
 * @param deps - The domain deps.
 */
function dropLink(deps: BridgeDeps): void {
  const { state } = deps;
  state.socket = undefined;
  state.session = undefined;
  dropAll(deps);
  dropInflight(state);
  dropShipping(state);
}

/**
 * A failure: drops the socket and what lived on it, then publishes lost and schedules a
 * reconnect with backoff, or gives up when `retry` is false. Does nothing more once stopped.
 *
 * @param deps - The domain deps.
 * @param reason - The status reason, e.g. "hello 404".
 * @param retry - Whether to reconnect.
 * @param restarting - The editor closed the socket for its restart (1012): logged at info.
 */
export function fail(deps: BridgeDeps, reason: string, retry: boolean, restarting = false): void {
  const { state } = deps;
  dropLink(deps);
  if (state.phase === "stopped") return;

  state.phase = "lost";
  if (!retry) {
    setStatus(deps, { kind: "lost", reason, lastFrame: state.lastFrame, retryInMs: 0 });
    deps.log.error("bridge:disabled", { reason });
    return;
  }

  const delay = nextDelay(state.attempt, deps.config.retryMs, deps.net.random);
  state.attempt += 1;
  setStatus(deps, { kind: "lost", reason, lastFrame: state.lastFrame, retryInMs: delay });
  state.retryTimer = setTimeout(() => {
    connectInBackground(deps);
  }, delay);
  logLoss(deps, reason, delay, restarting);
}

/**
 * True for the hub's 4401 `unpaired` close of a socket that carried a device id and token: the
 * credentials are dead.
 *
 * @param code - The close code.
 * @param reason - The close reason.
 * @param credentialed - The socket carried a device id and token.
 * @returns Whether the device should pair again at once.
 * @example
 * ```ts
 * isUnpairedClose(4401, "unpaired", true); // true
 * ```
 */
function isUnpairedClose(code: number, reason: string, credentialed: boolean): boolean {
  return code === DEVICE_UNPAIRED_CODE && reason === DEVICE_UNPAIRED_REASON && credentialed;
}

/**
 * True for the hub's 1008 `pairing refused` close: the person said no.
 *
 * @param code - The close code.
 * @param reason - The close reason.
 * @returns Whether the pairing was refused.
 * @example
 * ```ts
 * isPairingRefused(1008, "pairing refused"); // true
 * ```
 */
function isPairingRefused(code: number, reason: string): boolean {
  return code === POLICY_CLOSE && reason === PAIRING_REFUSED;
}

/**
 * A device-mode close the hub gave a meaning: 4401 `unpaired` on a credentialed socket drops the
 * dead credentials and dials again at once (no backoff, the streak unchanged), so the next socket
 * pairs; 1008 `pairing refused` stops retrying until `connect` asks again.
 *
 * @param deps - The domain deps.
 * @param code - The close code.
 * @param reason - The close reason.
 * @param credentialed - The socket carried a device id and token.
 * @returns Whether the close was handled here.
 */
function onDeviceClose(
  deps: BridgeDeps,
  code: number,
  reason: string,
  credentialed: boolean
): boolean {
  if (isUnpairedClose(code, reason, credentialed)) {
    dropLink(deps);
    onUnpaired(deps);
    connectInBackground(deps);
    return true;
  }
  if (isPairingRefused(code, reason)) {
    deps.state.pairing = undefined;
    deps.log.warn("bridge:pairing-refused", { address: deps.state.address });
    fail(deps, PAIRING_REFUSED, false);
    return true;
  }
  return false;
}

/**
 * Device mode: moves the next dial to the next candidate and publishes the new address.
 *
 * @param deps - The domain deps.
 */
function rotateAddress(deps: BridgeDeps): void {
  if (deps.state.phase === "stopped") return;
  const before = deps.state.address;
  rotateCandidate(deps);
  if (deps.state.address !== before) setStatus(deps, deps.state.status);
}

/**
 * Socket close: a failure with retry, named after the close code and the hub's reason (1008
 * `hello first`, 1001 `editor stopping`, 1012 `editor restarting`; a rejected upgrade shows as
 * 1006 in browsers). The bin's restart (1012) is logged at info, not warn. In device mode 4401
 * `unpaired` and 1008 `pairing refused` have their own rules; the pairing code survives any other
 * close, so the code on the phone does not change while the person types it.
 *
 * @param deps - The domain deps.
 * @param code - The close code.
 * @param reason - The close reason, possibly empty.
 * @param credentialed - The socket carried a device id and token (device mode).
 * @param opened - The socket opened before it closed; a device dial that never opened rotates to
 *   the next candidate (Delta 2026-10-18).
 */
export function onClose(
  deps: BridgeDeps,
  code: number,
  reason: string,
  credentialed = false,
  opened = true
): void {
  if (deps.state.mode === "device" && onDeviceClose(deps, code, reason, credentialed)) return;
  const base = `socket closed (${String(code)})`;
  fail(deps, reason === "" ? base : `${base}: ${reason}`, true, code === SERVICE_RESTART);
  // A device dial that never opened (no computer at this address): the next retry tries the next
  // candidate (Delta 2026-10-18), after the loss was published and logged for this one.
  if (!opened) rotateAddress(deps);
}

/**
 * Wires the socket events; events of a socket that is no longer the current one are ignored. An
 * open page socket or credentialed device socket runs the link step, a device socket without
 * credentials pairs. Every message is a sign of the computer.
 *
 * @param deps - The domain deps.
 * @param socket - The new socket.
 * @param credentialed - The socket carries the hub token (page) or the device's credentials.
 */
function listen(deps: BridgeDeps, socket: SocketLike, credentialed: boolean): void {
  const label = linkLabel(deps);
  let opened = false;
  socket.addEventListener("open", () => {
    if (deps.state.socket !== socket) return;
    opened = true;
    if (credentialed) onLinked(deps);
    else startPairing(deps);
  });
  socket.addEventListener("message", event => {
    if (deps.state.socket !== socket) return;
    noteSeen(deps);
    handleText(deps, event.data);
  });
  socket.addEventListener("close", event => {
    if (deps.state.socket === socket) onClose(deps, event.code, event.reason, credentialed, opened);
  });
  socket.addEventListener("error", () => {
    deps.log.debug("bridge:socket-error", { url: label });
  });
}

/**
 * Opens a socket and wires it; a throwing constructor is a failure with retry.
 *
 * @param deps - The domain deps.
 * @param url - The socket URL.
 * @param origin - The Origin to send (a Bun process in page mode), or undefined.
 * @param credentialed - The socket carries a token.
 */
function openSocket(
  deps: BridgeDeps,
  url: URL,
  origin: string | undefined,
  credentialed: boolean
): void {
  let socket: SocketLike;
  try {
    socket = deps.net.openSocket(url.href, origin);
  } catch {
    fail(deps, "socket failed", true);
    if (deps.state.mode === "device") rotateAddress(deps);
    return;
  }
  deps.state.socket = socket;
  listen(deps, socket, credentialed);
}

/**
 * Opens the socket of a hello answer (steps 8 and 9 of the page-mode connect sequence).
 *
 * @param deps - The domain deps.
 * @param helloUrl - The hello URL.
 * @param body - The hello body.
 */
function openLink(deps: BridgeDeps, helloUrl: URL, body: HelloBody): void {
  let url: URL;
  try {
    url = socketUrl(helloUrl, body);
  } catch {
    fail(deps, "hello answered a bad ws URL", true);
    return;
  }
  openSocket(deps, url, helloOrigin(helloUrl), true);
}

/**
 * True when a page-mode attempt is no longer the current one (read again after an await): stop
 * ran, a newer connect started (connect(address), overlay:connect, a retry), or the bridge left
 * page mode. Its hello answer then opens nothing and its failure fails nothing.
 *
 * @param deps - The domain deps.
 * @param dial - The generation of the attempt.
 * @returns Whether the attempt is stale.
 */
function isStale(deps: BridgeDeps, dial: number): boolean {
  const { state } = deps;
  return state.phase === "stopped" || state.dial !== dial || state.mode !== "page";
}

/**
 * Page mode: network check, hello URL, hello fetch (every attempt: a hub restart rotates the
 * token), then the socket. In a Bun process the hello origin goes along as the Origin header and
 * Bun's socket option (R6). A stop or a newer connect during the fetch opens nothing.
 *
 * @param deps - The domain deps.
 * @param dial - The generation of this attempt.
 * @returns A promise that settles when the socket is opening or the attempt failed.
 */
async function connectPage(deps: BridgeDeps, dial: number): Promise<void> {
  const { config, page } = deps;
  if (!hasNetwork(globalThis)) {
    fail(deps, "no WebSocket in this runtime", false);
    return;
  }
  const helloUrl = resolveHelloUrl(config.hello, page.href);
  if (helloUrl === undefined) {
    fail(deps, `no page URL for ${config.hello}`, false);
    return;
  }

  let body: HelloBody;
  try {
    const origin = helloOrigin(helloUrl);
    body = await fetchHello(deps.net, helloUrl, origin === undefined ? undefined : { origin });
  } catch (error) {
    if (!isStale(deps, dial)) fail(deps, bareMessage(messageOf(error)), true);
    return;
  }
  if (isStale(deps, dial)) return;
  openLink(deps, helloUrl, body);
}

/**
 * Device mode: the address's socket `ws://<address>{path}/ws?kind=agent&role=device`, with the
 * remembered credentials unless the next socket must pair. No hello fetch, no Origin of ours (the
 * WebView sets the native one).
 *
 * @param deps - The domain deps.
 */
function connectDevice(deps: BridgeDeps): void {
  const { state, config } = deps;
  if (!hasSocket(globalThis)) {
    fail(deps, "no WebSocket in this runtime", false);
    return;
  }
  const address = state.address ?? DEFAULT_DEVICE_ADDRESS;
  state.address = address;
  const credentials = credentialsOf(state);

  let url: URL;
  try {
    url = deviceSocketUrl(address, config.hello, credentials);
  } catch {
    fail(deps, `no socket URL for ${address}`, false);
    return;
  }
  openSocket(deps, url, undefined, credentials !== undefined);
}

/**
 * The connect sequence: a new generation, connecting, then page mode (hello, socket) or device
 * mode (socket, pairing). A stopped bridge connects nothing.
 *
 * @param deps - The domain deps.
 * @returns A promise that settles when the socket is opening or the attempt failed.
 */
export async function connect(deps: BridgeDeps): Promise<void> {
  const { state } = deps;
  if (state.phase === "stopped") return;
  state.dial += 1;
  state.retryTimer = undefined;
  state.phase = "connecting";
  setStatus(deps, { kind: "connecting" });

  if (state.mode === "device") connectDevice(deps);
  else await connectPage(deps, state.dial);
}

/**
 * Starts `connect` without awaiting it; a crash is logged, never thrown.
 *
 * @param deps - The domain deps.
 */
export function connectInBackground(deps: BridgeDeps): void {
  connect(deps).catch((error: unknown) => {
    deps.log.error("bridge:connect-crashed", undefined, asError(error));
  });
}

/**
 * Dials again now (another address, or the same one after a refusal): the current socket closes
 * with 1000 "switch" and its link is dropped, the retry timer and the failure streak are reset.
 *
 * @param deps - The domain deps.
 */
export function redial(deps: BridgeDeps): void {
  const { state } = deps;
  const { socket } = state;
  dropLink(deps);
  socket?.close(NORMAL_CLOSE, "switch");
  if (state.retryTimer !== undefined) clearTimeout(state.retryTimer);
  state.retryTimer = undefined;
  state.attempt = 0;
  state.failureLogged = false;
  connectInBackground(deps);
}
