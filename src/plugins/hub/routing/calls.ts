/**
 * @file hub plugin — forwarded calls: hub ids, deadlines (R1: `editor.series` waits its duration
 * and `editor.sheet` its `frames × everyMs` on top, capped at 60 s), settling the agent's answers
 * to their reply target, timeouts (-32002) and failing every call of a closing session (-32001),
 * both retryable.
 */
import type { Json, Response as RpcResponse, WireError } from "../../registry/protocol";
import {
  errorCode,
  failure,
  isFailure,
  request,
  success,
  toWireError,
  wireError
} from "../../registry/protocol";
import { sendJson, toolsConn } from "../sockets/send";
import type { HubCtx, HubState, Reply, Session } from "../types";
import { settleWatch } from "./shared";

/**
 * The run id whose deadline grows with its `durationMs` (R1).
 */
const SERIES_ID = "editor.series";

/**
 * The run id whose deadline grows with its `frames × everyMs` (the contact sheet).
 */
const SHEET_ID = "editor.sheet";

/**
 * The cap of the long-call extension (R1).
 */
const LONG_CALL_CAP_MS = 60_000;

/**
 * The reply target of a call whose answer nobody waits for.
 */
const DISCARD: Reply = { kind: "discard" };

/**
 * The error of a call whose game went away (retryable).
 *
 * @returns The plain wire error.
 * @example
 * ```ts
 * gameReloaded().data; // { reason: "game_reloaded", retryable: true }
 * ```
 */
function gameReloaded(): WireError {
  return toWireError(
    wireError(errorCode.gameReloaded, "game reloaded", { reason: "game_reloaded", retryable: true })
  );
}

/**
 * The error of a call past its deadline (retryable).
 *
 * @returns The plain wire error.
 * @example
 * ```ts
 * timedOut().data; // { reason: "timeout", retryable: true }
 * ```
 */
function timedOut(): WireError {
  return toWireError(
    wireError(errorCode.timeout, "call timed out", { reason: "timeout", retryable: true })
  );
}

/**
 * Reads a member of a JSON object, or undefined.
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
 * lengthOf("500"); // 0
 * ```
 */
function lengthOf(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The extra wait of a long run (R1): `input.durationMs` of `editor.series`, `input.frames ×
 * input.everyMs` of `editor.sheet`; 0 for every other call or a bad value.
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
 * The deadline of a forwarded call: callTimeoutMs, plus the long-call extension (capped at 60 s)
 * for a `run` of `editor.series` (`input.durationMs`) or `editor.sheet` (`input.frames ×
 * input.everyMs`) only (R1, the same rule on every hop).
 *
 * @param method - The request method.
 * @param params - The request params.
 * @param callTimeoutMs - config.callTimeoutMs.
 * @returns The deadline in ms.
 * @example
 * ```ts
 * deadlineFor("run", { id: "editor.series", input: { durationMs: 20_000, intervalMs: 100 } }, 5000); // 25000
 * deadlineFor("run", { id: "editor.sheet", input: { frames: 6, everyMs: 500 } }, 5000); // 8000
 * ```
 */
export function deadlineFor(
  method: string,
  params: Json | undefined,
  callTimeoutMs: number
): number {
  return callTimeoutMs + Math.min(longCallMs(method, params), LONG_CALL_CAP_MS);
}

/**
 * Sends an answer to its reply target: a tools response with the tools id, every waiting watch
 * subscriber, or nobody.
 *
 * @param ctx - Domain context of the hub.
 * @param reply - The reply target.
 * @param response - The answer (agent response or hub-built failure).
 */
function deliver(ctx: HubCtx, reply: Reply, response: RpcResponse): void {
  if (reply.kind === "watch") {
    settleWatch(ctx, reply.key, response);
    return;
  }
  if (reply.kind === "discard") return;

  const tools = toolsConn(ctx.state, reply.conn);
  if (tools === undefined) return;

  tools.pending = Math.max(0, tools.pending - 1);
  sendJson(
    tools,
    isFailure(response)
      ? failure(reply.toolsId, response.error)
      : success(reply.toolsId, response.result)
  );
}

/**
 * Fails a pending call past its deadline with -32002.
 *
 * @param ctx - Domain context of the hub.
 * @param id - The hub id.
 */
function expire(ctx: HubCtx, id: number): void {
  const call = ctx.state.pending.get(id);
  if (call === undefined) return;

  ctx.state.pending.delete(id);
  deliver(ctx, call.reply, failure(id, timedOut()));
}

/**
 * Forwards a game-channel request to the session's agent under a new hub id, with a deadline.
 * A tools reply counts against that connection's pending calls.
 *
 * @param ctx - Domain context of the hub.
 * @param session - The target session.
 * @param method - The game method.
 * @param params - The params, omitted when undefined.
 * @param reply - Where the answer goes.
 */
export function forward(
  ctx: HubCtx,
  session: Session,
  method: string,
  params: Json | undefined,
  reply: Reply
): void {
  const { state, config } = ctx;
  const id = state.nextCallId;
  state.nextCallId += 1;

  if (reply.kind === "tools") {
    const tools = toolsConn(state, reply.conn);
    if (tools !== undefined) tools.pending += 1;
  }

  const agent = state.conns.get(session.conn);
  if (agent?.kind !== "agent") {
    deliver(ctx, reply, failure(id, gameReloaded()));
    return;
  }

  const deadline = deadlineFor(method, params, config.callTimeoutMs);
  const timer = setTimeout(() => expire(ctx, id), deadline);
  state.pending.set(id, { id, session: session.id, timer, reply });
  sendJson(agent, request(id, "game", method, params));
}

/**
 * Settles the agent's response to a pending call; an unknown id (late after a timeout, or a call
 * of another session) is ignored and logged at debug level.
 *
 * @param ctx - Domain context of the hub.
 * @param response - The agent's response.
 * @param from - The session of the answering agent; a call of another session is unknown.
 */
export function settle(ctx: HubCtx, response: RpcResponse, from?: string): void {
  const call = ctx.state.pending.get(response.id);
  if (call === undefined || (from !== undefined && call.session !== from)) {
    ctx.log.debug("hub:late-response", { id: response.id });
    return;
  }

  clearTimeout(call.timer);
  ctx.state.pending.delete(response.id);
  deliver(ctx, call.reply, response);
}

/**
 * Fails every pending call of a session with -32001 `game_reloaded` (retryable); calls of other
 * sessions keep waiting.
 *
 * @param ctx - Domain context of the hub.
 * @param id - The session id.
 */
export function failSession(ctx: HubCtx, id: string): void {
  for (const call of ctx.state.pending.values()) {
    if (call.session !== id) continue;
    clearTimeout(call.timer);
    ctx.state.pending.delete(call.id);
    deliver(ctx, call.reply, failure(call.id, gameReloaded()));
  }
}

/**
 * Turns the replies of a closed tools connection into `discard`.
 *
 * @param state - Hub state.
 * @param conn - The tools connection number.
 */
export function discardReplies(state: HubState, conn: number): void {
  for (const call of state.pending.values()) {
    if (call.reply.kind === "tools" && call.reply.conn === conn) call.reply = DISCARD;
  }
}

/**
 * Turns the agent watch call of a removed shared watch into `discard`, so its late answer cannot
 * settle a newer watch of the same key.
 *
 * @param state - Hub state.
 * @param key - The subKey.
 */
export function discardWatchCalls(state: HubState, key: string): void {
  for (const call of state.pending.values()) {
    if (call.reply.kind === "watch" && call.reply.key === key) call.reply = DISCARD;
  }
}

/**
 * The reply target of a call whose answer nobody waits for.
 *
 * @returns `{ kind: "discard" }`.
 * @example
 * ```ts
 * discard(); // { kind: "discard" }
 * ```
 */
export function discard(): Reply {
  return DISCARD;
}
