/**
 * @file bridge plugin — the link step shared by page mode's open and device mode's open or
 * `paired`: streak reset, `hello { manifest, caps }` first, a heartbeat, live or paused, log
 * shipping.
 * Also the heartbeat send and the URL log lines name (never a query, so never a token).
 */
import type { HelloCaps } from "../../hub/protocol";
import { RUN_FROM_CAP } from "../../hub/protocol";
import type { Heartbeat, HelloParams } from "../../registry/protocol";
import { notification, toWireValue } from "../../registry/protocol";
import { helloManifest } from "../checkpoint/checkpoint";
import { SOCKET_OPEN, sendNow } from "../dispatch/send";
import { shipNext } from "../lines";
import { setStatus, statusOfBeat } from "../status";
import type { BridgeDeps } from "../types";
import { deviceSocketUrl } from "./address";
import { resolveHelloUrl } from "./hello";

/**
 * The URL log lines name: the hello origin and path in page mode, `ws://<address>{path}/ws` in
 * device mode. Never a query.
 *
 * @param deps - The domain deps.
 * @returns The label.
 */
export function linkLabel(deps: Pick<BridgeDeps, "config" | "state" | "page">): string {
  const { config, state } = deps;
  if (state.mode === "device" && state.address !== undefined) {
    try {
      const url = deviceSocketUrl(state.address, config.hello);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return state.address;
    }
  }
  const url = resolveHelloUrl(config.hello, deps.page.href);
  return url === undefined ? config.hello : `${url.origin}${url.pathname}`;
}

/**
 * Sends a heartbeat, records its frame and publishes live or paused (on a kind flip only). A beat
 * sent while the socket had nothing buffered (the OS took the previous one) is a sign of the
 * computer: `seenAt`.
 *
 * @param deps - The domain deps.
 * @param beat - The beat.
 */
export function sendBeat(deps: BridgeDeps, beat: Heartbeat): void {
  const { state } = deps;
  const { socket } = state;
  if (socket?.readyState === SOCKET_OPEN && (socket.bufferedAmount ?? 0) === 0) {
    state.seenAt = Date.now();
  }
  sendNow(deps, notification("game", "heartbeat", beat));
  state.lastFrame = beat.frame;
  setStatus(deps, statusOfBeat(beat));
}

/**
 * The link step: sends `hello { manifest, caps }` first (the hub closes an agent that sends
 * anything else first; the manifest carries the build, and `restored` after a checkpoint restore;
 * `caps: ["run-from"]` asks the hub to stamp who ran each `run`, spec 07 B1), then a
 * heartbeat, publishes live or paused, logs the link and starts shipping the recorder's log
 * (device mode). Page mode resets the failure streak here; device mode resets it, and marks the
 * page linked, only when the hub answers with a session (`onSession`), so a hub that closes every
 * link before its session (4401 on each reconnect) cannot cycle the phone faster than the backoff.
 *
 * @param deps - The domain deps.
 */
export function onLinked(deps: BridgeDeps): void {
  const { state } = deps;
  if (state.mode === "page") {
    state.attempt = 0;
    state.failureLogged = false;
  }
  state.shippingStalled = false;
  state.phase = "open";
  if (state.retryTimer !== undefined) clearTimeout(state.retryTimer);
  state.retryTimer = undefined;

  const hello: HelloParams & HelloCaps = { manifest: helloManifest(deps), caps: [RUN_FROM_CAP] };
  sendNow(deps, notification("game", "hello", toWireValue(hello)));
  sendBeat(deps, deps.channel.heartbeat());
  deps.log.info("bridge:connected", { url: linkLabel(deps) });
  shipNext(deps);
}
