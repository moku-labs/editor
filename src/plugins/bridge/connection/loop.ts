/**
 * @file bridge plugin — the connection loop: hello fetch, socket, `hello` first, the heartbeat
 * tick, close and failure handling with backoff. `connect` never throws and is never awaited by
 * onStart. The token is never logged: log lines name the hello origin and path only.
 */
import type { Heartbeat, HelloBody } from "../../registry/protocol";
import { bareMessage, notification, toWireValue } from "../../registry/protocol";
import { asError, handleText } from "../dispatch/dispatch";
import { dropInflight, flushPending, messageOf, sendNow } from "../dispatch/send";
import { dropAll, sampleFrames } from "../dispatch/subscriptions";
import { setStatus, statusOfBeat } from "../status";
import type { BridgeDeps, SocketLike } from "../types";
import { nextDelay } from "./backoff";
import { fetchHello, helloOrigin, resolveHelloUrl, socketUrl } from "./hello";
import { hasNetwork } from "./socket";

/**
 * The hello URL as log lines show it: origin and path, never a query.
 *
 * @param deps - The domain deps.
 * @returns `origin + pathname`, or config.hello when it does not resolve.
 */
function helloLabel(deps: BridgeDeps): string {
  const url = resolveHelloUrl(deps.config.hello, deps.page.href);
  return url === undefined ? deps.config.hello : `${url.origin}${url.pathname}`;
}

/**
 * Sends a heartbeat, records its frame and publishes live or paused (on a kind flip only).
 *
 * @param deps - The domain deps.
 * @param beat - The beat.
 */
export function sendBeat(deps: BridgeDeps, beat: Heartbeat): void {
  sendNow(deps, notification("game", "heartbeat", beat));
  deps.state.lastFrame = beat.frame;
  setStatus(deps, statusOfBeat(beat));
}

/**
 * The channel heartbeat tick, active only while open: beat (even congested), status, backlog
 * flush, then the frame-source sampling (R6).
 *
 * @param deps - The domain deps.
 * @param beat - The beat of this tick.
 */
export function onBeat(deps: BridgeDeps, beat: Heartbeat): void {
  if (deps.state.phase !== "open") return;
  sendBeat(deps, beat);
  flushPending(deps);
  sampleFrames(deps);
}

/**
 * Socket open: resets the failure streak, sends `hello { manifest }` first (the hub closes an
 * agent that sends anything else first), then a heartbeat, publishes live or paused.
 *
 * @param deps - The domain deps.
 */
export function onOpen(deps: BridgeDeps): void {
  const { state } = deps;
  state.attempt = 0;
  state.failureLogged = false;
  state.phase = "open";
  if (state.retryTimer !== undefined) clearTimeout(state.retryTimer);
  state.retryTimer = undefined;

  sendNow(deps, notification("game", "hello", { manifest: toWireValue(deps.registry.manifest()) }));
  sendBeat(deps, deps.channel.heartbeat());
  deps.log.info("bridge:connected", { url: helloLabel(deps) });
}

/**
 * Logs a loss: the first failure of a streak at warn, the rest at debug (a game without an
 * editor server must not flood its log).
 *
 * @param deps - The domain deps.
 * @param reason - The status reason.
 * @param retryInMs - The scheduled delay.
 */
function logLoss(deps: BridgeDeps, reason: string, retryInMs: number): void {
  const { state, log } = deps;
  if (state.failureLogged) {
    log.debug("bridge:lost", { reason, retryInMs });
    return;
  }
  state.failureLogged = true;
  log.warn("bridge:lost", { reason, retryInMs });
}

/**
 * A failure: drops the socket, the session, every subscription and every deadline (late results
 * are dropped), then publishes lost and schedules a reconnect with backoff, or gives up when
 * `retry` is false. Does nothing more once stopped.
 *
 * @param deps - The domain deps.
 * @param reason - The status reason, e.g. "hello 404".
 * @param retry - Whether to reconnect.
 */
export function fail(deps: BridgeDeps, reason: string, retry: boolean): void {
  const { state } = deps;
  state.socket = undefined;
  state.session = undefined;
  dropAll(deps);
  dropInflight(state);
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
  logLoss(deps, reason, delay);
}

/**
 * Socket close: a failure with retry, named after the close code and the hub's reason (1008
 * `hello first`, 1001 `editor stopping`; a rejected upgrade shows as 1006 in browsers).
 *
 * @param deps - The domain deps.
 * @param code - The close code.
 * @param reason - The close reason, possibly empty.
 */
export function onClose(deps: BridgeDeps, code: number, reason: string): void {
  const base = `socket closed (${String(code)})`;
  fail(deps, reason === "" ? base : `${base}: ${reason}`, true);
}

/**
 * Wires the socket events; events of a socket that is no longer the current one are ignored.
 *
 * @param deps - The domain deps.
 * @param socket - The new socket.
 */
function listen(deps: BridgeDeps, socket: SocketLike): void {
  const label = helloLabel(deps);
  socket.addEventListener("open", () => {
    if (deps.state.socket === socket) onOpen(deps);
  });
  socket.addEventListener("message", event => {
    if (deps.state.socket === socket) handleText(deps, event.data);
  });
  socket.addEventListener("close", event => {
    if (deps.state.socket === socket) onClose(deps, event.code, event.reason);
  });
  socket.addEventListener("error", () => {
    deps.log.debug("bridge:socket-error", { url: label });
  });
}

/**
 * Opens the socket of a hello answer (steps 8 and 9 of the connect sequence).
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
  let socket: SocketLike;
  try {
    socket = deps.net.openSocket(url.href, helloOrigin(helloUrl));
  } catch {
    fail(deps, "socket failed", true);
    return;
  }
  deps.state.socket = socket;
  listen(deps, socket);
}

/**
 * True once onStop ran (read again after an await: stop may run meanwhile).
 *
 * @param deps - The domain deps.
 * @returns Whether the phase is "stopped".
 */
function isStopped(deps: BridgeDeps): boolean {
  return deps.state.phase === "stopped";
}

/**
 * The connect sequence: connecting, network check, hello URL, hello fetch (every attempt: a hub
 * restart rotates the token), then the socket. In a Bun process the hello origin goes along as
 * the Origin header and Bun's socket option (R6). A stop during the fetch opens nothing.
 *
 * @param deps - The domain deps.
 * @returns A promise that settles when the socket is opening or the attempt failed.
 */
export async function connect(deps: BridgeDeps): Promise<void> {
  const { state, config, page } = deps;
  if (state.phase === "stopped") return;
  state.retryTimer = undefined;
  state.phase = "connecting";
  setStatus(deps, { kind: "connecting" });

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
    fail(deps, bareMessage(messageOf(error)), true);
    return;
  }
  if (isStopped(deps)) return;
  openLink(deps, helloUrl, body);
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
