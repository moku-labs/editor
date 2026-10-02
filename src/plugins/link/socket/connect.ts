/**
 * @file link plugin — socket/connect.ts (skeleton stubs, implemented in its wave).
 */
import type { LinkCtx } from "../types";

/**
 * Skeleton stub for `openSocket`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * openSocket();
 * ```
 */
export function openSocket(_ctx: LinkCtx): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `createSocket`; implemented in its wave.
 *
 * @param _url - The url.
 * @param _origin - The origin.
 * @example
 * ```ts
 * createSocket();
 * ```
 */
export function createSocket(_url: string, _origin: string | undefined): WebSocket {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `bootOrigin`; implemented in its wave.
 *
 * @param _ws - The ws.
 * @param _base - The base.
 * @example
 * ```ts
 * bootOrigin();
 * ```
 */
export function bootOrigin(_ws: string, _base: string): string {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `onSocketMessage`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _text - The text.
 * @example
 * ```ts
 * onSocketMessage();
 * ```
 */
export function onSocketMessage(_ctx: LinkCtx, _text: string): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `onSocketClose`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _event - The event.
 * @param _event.code - The code.
 * @param _event.reason - The reason.
 * @example
 * ```ts
 * onSocketClose();
 * ```
 */
export function onSocketClose(
  _ctx: LinkCtx,
  _event: { readonly code: number; readonly reason: string }
): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `scheduleReconnect`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * scheduleReconnect();
 * ```
 */
export function scheduleReconnect(_ctx: LinkCtx): void {
  throw new Error("not implemented");
}
