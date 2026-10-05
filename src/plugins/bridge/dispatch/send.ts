/**
 * @file bridge plugin — sending: messages at once when the socket is open, values coalesced per
 * subscription (latest wins) while the socket is congested, and the backlog flushed in insertion
 * order once it drains.
 */
import type { Json, Message, SubId } from "../../registry/protocol";
import { encode, notification } from "../../registry/protocol";
import type { BridgeDeps, BridgeState, SocketLike } from "../types";
import { HIGH_WATER, LOW_WATER } from "../types";

/**
 * `readyState` of an open websocket.
 */
export const SOCKET_OPEN = 1;

/**
 * Websocket close code of a normal closure (RFC 6455 §7.4.1): the page said bye.
 */
export const NORMAL_CLOSE = 1000;

/**
 * The message of a thrown value.
 *
 * @param error - Anything thrown.
 * @returns Its message, or its text.
 * @example
 * ```ts
 * messageOf(new Error("boom")); // "boom"
 * ```
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The bytes a socket still has to send; a missing `bufferedAmount` counts as 0.
 *
 * @param socket - The socket.
 * @returns The buffered byte count.
 */
function bufferedOf(socket: SocketLike): number {
  return socket.bufferedAmount ?? 0;
}

/**
 * True when more than HIGH_WATER bytes wait in the socket.
 *
 * @param socket - The socket.
 * @returns Whether new values should wait in the backlog.
 * @example
 * ```ts
 * const socket: SocketLike = {
 *   readyState: 1,
 *   bufferedAmount: 2_000_000,
 *   send() {},
 *   close() {},
 *   addEventListener() {}
 * };
 * congested(socket); // true: above HIGH_WATER (1_048_576)
 * congested({ ...socket, bufferedAmount: 1000 }); // false
 * ```
 */
export function congested(socket: SocketLike): boolean {
  return bufferedOf(socket) > HIGH_WATER;
}

/**
 * Sends one message at once when the socket is open; drops it otherwise. Responses, heartbeats,
 * hello and bye always go this way, congested or not.
 *
 * @param deps - The state and the log.
 * @param message - The message.
 */
export function sendNow(deps: Pick<BridgeDeps, "state" | "log">, message: Message): void {
  const { socket } = deps.state;
  if (socket === undefined || socket.readyState !== SOCKET_OPEN) return;
  try {
    socket.send(encode(message));
  } catch (error) {
    deps.log.debug("bridge:send-failed", { message: messageOf(error) });
  }
}

/**
 * Says `bye` on the open socket right before the page reloads on purpose (Bun's full reload,
 * `editor.reload`): the hub then ends the session with reason `bye`, which the tools read as an
 * expected reload (U7). The socket stays open until the page goes. Dropped without an open socket.
 *
 * @param deps - The state and the log.
 */
export function sendBye(deps: Pick<BridgeDeps, "state" | "log">): void {
  sendNow(deps, notification("game", "bye"));
}

/**
 * Sends a `value` notification, or keeps it in the backlog while congested (latest wins); records
 * its text as the last value of the subscription either way.
 *
 * @param deps - The state and the log.
 * @param sub - The subscription id.
 * @param value - The value.
 * @param text - `JSON.stringify(value)`, for the dedupe.
 */
export function sendValue(
  deps: Pick<BridgeDeps, "state" | "log">,
  sub: SubId,
  value: Json,
  text: string
): void {
  const { state } = deps;
  if (state.socket !== undefined && congested(state.socket)) {
    state.pending.set(sub, value);
  } else {
    sendNow(deps, notification("game", "value", { sub, value }));
  }
  const record = state.subs.get(sub);
  if (record !== undefined) record.lastSent = text;
}

/**
 * Sends the backlog in insertion order once fewer than LOW_WATER bytes wait, until the socket is
 * congested again.
 *
 * @param deps - The state and the log.
 */
export function flushPending(deps: Pick<BridgeDeps, "state" | "log">): void {
  const { socket, pending } = deps.state;
  if (socket === undefined || bufferedOf(socket) >= LOW_WATER) return;
  for (const [sub, value] of pending) {
    if (congested(socket)) return;
    pending.delete(sub);
    sendNow(deps, notification("game", "value", { sub, value }));
  }
}

/**
 * Clears every request deadline: late results of those requests are dropped.
 *
 * @param state - The bridge state.
 */
export function dropInflight(state: BridgeState): void {
  for (const timer of state.inflight.values()) clearTimeout(timer);
  state.inflight.clear();
}
