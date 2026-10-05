/**
 * @file link plugin — JSON-RPC calls over the tools socket: ids, deadlines (R1 long calls),
 * settling responses and failing everything when the link closes.
 */

import type { Channel, Json, Response as RpcResponse, WireError } from "../../registry/protocol";
import {
  encode,
  errorCode,
  fromWireError,
  isFailure,
  isWireError,
  request as rpcRequest,
  wireError
} from "../../registry/protocol";
import type { LinkCtx, LinkState } from "../types";
import { CALL_TIMEOUT_MS, LONG_CALL_CAP_MS } from "../types";

/**
 * The run id whose deadline grows with its `durationMs` (R1).
 */
const SERIES_ID = "editor.series";

/**
 * The run id whose deadline grows with its `frames × everyMs` (the contact sheet).
 */
const SHEET_ID = "editor.sheet";

/**
 * The error of every call the closed link cannot finish (R1 `link_closed`, R7: -32002).
 *
 * @returns A retryable wire error.
 * @example
 * ```ts
 * linkClosedError().data; // { reason: "link_closed", retryable: true }
 * ```
 */
export function linkClosedError(): Error & WireError {
  return wireError(errorCode.timeout, "The link to the editor server closed.", {
    reason: "link_closed",
    retryable: true
  });
}

/**
 * The error of a game call made while no session is attached (not retryable).
 *
 * @returns A -32003 `no_session` wire error.
 * @example
 * ```ts
 * noSessionError().code; // -32003
 * ```
 */
export function noSessionError(): Error & WireError {
  return wireError(errorCode.noSession, "No game is connected.", {
    reason: "no_session",
    retryable: false
  });
}

/**
 * The code and reason of an error, for a log line (never the message, which may name paths).
 *
 * @param error - Anything a call rejected with.
 * @returns `{ code, reason }`, each only when present.
 * @example
 * ```ts
 * describeError(noSessionError()); // { code: -32003, reason: "no_session" }
 * describeError(new Error("x")); // {}
 * ```
 */
export function describeError(error: unknown): { code?: number; reason?: string } {
  if (!isWireError(error)) return {};

  const reason = error.data?.reason;
  return reason === undefined ? { code: error.code } : { code: error.code, reason };
}

/**
 * Reads a JSON object member, or undefined.
 *
 * @param value - A Json value.
 * @param key - The member.
 * @returns The member when `value` is an object.
 * @example
 * ```ts
 * memberOf({ input: { durationMs: 5 } }, "input"); // { durationMs: 5 }
 * ```
 */
function memberOf(value: Json | undefined, key: string): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value[key]
    : undefined;
}

/**
 * A length in ms or a count: a finite number ≥ 0, else 0.
 *
 * @param value - A Json member.
 * @returns The number, or 0.
 * @example
 * ```ts
 * lengthOf(500); // 500
 * lengthOf(undefined); // 0
 * ```
 */
function lengthOf(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The extra wait of a long run (R1): `durationMs` of `editor.series`, `frames × everyMs` of
 * `editor.sheet`; 0 for every other call or a bad value.
 *
 * @param method - The request method.
 * @param params - The request params.
 * @returns The extra wait in ms, not capped.
 * @example
 * ```ts
 * longCallMs("run", { id: "editor.sheet", input: { frames: 6, everyMs: 500 } }); // 3000
 * ```
 */
function longCallMs(method: string, params: Json | undefined): number {
  if (method !== "run") return 0;

  const id = memberOf(params, "id");
  const input = memberOf(params, "input");
  if (id === SERIES_ID) return lengthOf(memberOf(input, "durationMs"));
  if (id === SHEET_ID) {
    return lengthOf(memberOf(input, "frames")) * lengthOf(memberOf(input, "everyMs"));
  }
  return 0;
}

/**
 * The local deadline of a call: CALL_TIMEOUT_MS, plus the long-call extension (capped at 60 s)
 * for a `run` of `editor.series` (`durationMs`) or `editor.sheet` (`frames × everyMs`), the R1
 * long-call rule every hop uses.
 *
 * @param method - The request method.
 * @param params - The request params.
 * @returns The deadline in ms.
 * @example
 * ```ts
 * timeoutFor("run", { id: "editor.series", input: { durationMs: 20_000, intervalMs: 100 } }); // 30000
 * timeoutFor("run", { id: "editor.sheet", input: { frames: 6, everyMs: 500 } }); // 13000
 * ```
 */
export function timeoutFor(method: string, params: Json | undefined): number {
  return CALL_TIMEOUT_MS + Math.min(longCallMs(method, params), LONG_CALL_CAP_MS);
}

/**
 * Sends a request and resolves with its result. Rejects with the hub's error (rebuilt with its
 * code and data), -32002 `timeout` after the deadline, or `link_closed` when the socket is not
 * open or closes first. Game-channel calls pass the session; files calls never do.
 *
 * @param ctx - Domain context of link.
 * @param channel - Logical channel.
 * @param method - Method name.
 * @param params - Params, omitted when undefined.
 * @param session - Session id (game channel).
 * @returns The result.
 */
export function request(
  ctx: LinkCtx,
  channel: Channel,
  method: string,
  params: Json | undefined,
  session?: string
): Promise<Json> {
  const { state } = ctx;
  const { socket } = state;

  if (!state.open || socket === undefined) return Promise.reject(linkClosedError());

  const id = state.nextId;
  state.nextId += 1;

  return new Promise<Json>((resolve, reject) => {
    const ms = timeoutFor(method, params);
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(
        wireError(errorCode.timeout, `${method} timed out after ${ms} ms.`, {
          reason: "timeout",
          retryable: true
        })
      );
    }, ms);
    state.pending.set(id, { resolve, reject, timer });

    try {
      socket.send(encode(rpcRequest(id, channel, method, params, session)));
    } catch {
      clearTimeout(timer);
      state.pending.delete(id);
      reject(linkClosedError());
    }
  });
}

/**
 * Sends a game-channel request to the chosen session; rejects `no_session` at once when the
 * socket is closed or nothing is chosen.
 *
 * @param ctx - Domain context of link.
 * @param method - Game method (`read`, `run`).
 * @param params - Params.
 * @returns The result.
 */
export function gameRequest(ctx: LinkCtx, method: string, params: Json): Promise<Json> {
  const { open, chosen } = ctx.state;

  if (!open || chosen === undefined) return Promise.reject(noSessionError());
  return request(ctx, "game", method, params, chosen);
}

/**
 * Resolves or rejects the pending call of a response and clears its timer.
 *
 * @param ctx - Domain context of link.
 * @param response - A decoded response.
 */
export function settle(ctx: LinkCtx, response: RpcResponse): void {
  const call = ctx.state.pending.get(response.id);

  if (call === undefined) {
    ctx.log.debug("link:unknown-response", { id: response.id });
    return;
  }
  clearTimeout(call.timer);
  ctx.state.pending.delete(response.id);

  if (isFailure(response)) call.reject(fromWireError(response.error));
  else call.resolve(response.result);
}

/**
 * Rejects every pending call with one error and clears every call timer.
 *
 * @param ctx - Any context holding the link state (onStop has only `{ state }`).
 * @param ctx.state - Link state.
 * @param error - The error, usually `linkClosedError()`.
 */
export function failAll(ctx: { readonly state: LinkState }, error: Error & WireError): void {
  const { pending } = ctx.state;

  for (const call of pending.values()) {
    clearTimeout(call.timer);
    call.reject(error);
  }
  pending.clear();
}
