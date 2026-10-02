/**
 * @file bridge plugin — dispatch/send.ts (skeleton stubs, implemented in its wave).
 */
import type { Json, Message, SubId } from "../../registry/protocol";
import type { BridgeDeps, SocketLike } from "../types";

/**
 * Skeleton stub for `sendNow`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _message - The message.
 * @example
 * ```ts
 * sendNow();
 * ```
 */
export function sendNow(_deps: BridgeDeps, _message: Message): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `sendValue`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _sub - The sub.
 * @param _value - The value.
 * @param _text - The text.
 * @example
 * ```ts
 * sendValue();
 * ```
 */
export function sendValue(_deps: BridgeDeps, _sub: SubId, _value: Json, _text: string): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `flushPending`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @example
 * ```ts
 * flushPending();
 * ```
 */
export function flushPending(_deps: BridgeDeps): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `congested`; implemented in its wave.
 *
 * @param _socket - The socket.
 * @example
 * ```ts
 * congested();
 * ```
 */
export function congested(_socket: SocketLike): boolean {
  throw new Error("not implemented");
}
