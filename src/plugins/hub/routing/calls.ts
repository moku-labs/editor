/**
 * @file hub plugin — forwarded calls: hub ids, deadlines (R1: `editor.series` waits its duration
 * and `editor.sheet` its `frames × everyMs` on top, `editor.select` with a card 3 × callTimeoutMs,
 * capped at 60 s), settling an answer from the call's own target (an agent session or an editor
 * page, A3) to its reply target, timeouts (-32002), and failing the calls of a closing session
 * (-32001 `game_reloaded`) or page (-32001 `page_closed`), all retryable.
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
import type { CallTarget, HubCtx, HubState, PendingCall, Reply, Session } from "../types";
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
 * The editor-channel method relayed to the editor page (A6): with a card it waits longer.
 */
const SELECT_METHOD = "select";

/**
 * A select with a card waits this many call timeouts in all (A6): the pick writes the shots and
 * the card first.
 */
const SELECT_CARD_TIMEOUTS = 4;

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
 * The error of a relayed call whose editor page closed before it answered (retryable).
 *
 * @returns The plain wire error.
 * @example
 * ```ts
 * pageClosed().data; // { reason: "page_closed", retryable: true }
 * ```
 */
function pageClosed(): WireError {
  return toWireError(
    wireError(errorCode.pageClosed, "editor page closed", {
      reason: "page_closed",
      retryable: true
    })
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
 * The extra wait of a long call: `input.durationMs` of a `run` of `editor.series` (R1),
 * `input.frames × input.everyMs` of a `run` of `editor.sheet`, 3 × callTimeoutMs of a `select`
 * relayed to the editor page with a card (`card` true or absent, A6); 0 for every other call or a
 * bad value.
 *
 * @param method - The request method.
 * @param params - The request params.
 * @param callTimeoutMs - config.callTimeoutMs.
 * @returns The extra wait in ms, not capped.
 * @example
 * ```ts
 * longCallMs("run", { id: "editor.sheet", input: { frames: 6, everyMs: 500 } }, 5000); // 3000
 * longCallMs("select", { key: "coins" }, 5000); // 15000
 * ```
 */
function longCallMs(method: string, params: Json | undefined, callTimeoutMs: number): number {
  if (method === SELECT_METHOD) {
    return memberOf(params, "card") === false ? 0 : (SELECT_CARD_TIMEOUTS - 1) * callTimeoutMs;
  }
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
 * input.everyMs`) (R1, the same rule on every hop) and for a `select` with a card relayed to the
 * editor page (4 × callTimeoutMs in all, A6).
 *
 * @param method - The request method.
 * @param params - The request params.
 * @param callTimeoutMs - config.callTimeoutMs.
 * @returns The deadline in ms.
 * @example
 * ```ts
 * deadlineFor("run", { id: "editor.series", input: { durationMs: 20_000, intervalMs: 100 } }, 5000); // 25000
 * deadlineFor("run", { id: "editor.sheet", input: { frames: 6, everyMs: 500 } }, 5000); // 8000
 * deadlineFor("select", { key: "coins", card: true }, 5000); // 20000
 * ```
 */
export function deadlineFor(
  method: string,
  params: Json | undefined,
  callTimeoutMs: number
): number {
  return callTimeoutMs + Math.min(longCallMs(method, params, callTimeoutMs), LONG_CALL_CAP_MS);
}

/**
 * True when two call targets name the same agent session or the same page connection.
 *
 * @param left - A call target.
 * @param right - Another call target.
 * @returns Whether they are the same target.
 * @example
 * ```ts
 * sameTarget({ kind: "page", conn: 4 }, { kind: "page", conn: 4 }); // true
 * sameTarget({ kind: "agent", session: "s-1" }, { kind: "page", conn: 4 }); // false
 * ```
 */
function sameTarget(left: CallTarget, right: CallTarget): boolean {
  if (left.kind === "agent") return right.kind === "agent" && left.session === right.session;

  return right.kind === "page" && left.conn === right.conn;
}

/**
 * Sends an answer to its reply target: a tools response with the tools id, every waiting watch
 * subscriber, or nobody.
 *
 * @param ctx - Domain context of the hub.
 * @param reply - The reply target.
 * @param response - The answer (the target's response or a hub-built failure).
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
 * Ends a pending call: its timer stops, it is forgotten and the answer goes to its reply target.
 *
 * @param ctx - Domain context of the hub.
 * @param call - The pending call.
 * @param response - The answer (a target's response or a hub-built failure).
 */
function finish(ctx: HubCtx, call: PendingCall, response: RpcResponse): void {
  clearTimeout(call.timer);
  ctx.state.pending.delete(call.id);
  deliver(ctx, call.reply, response);
}

/**
 * Fails a pending call with a hub-built error: -32002 past its deadline, -32001 when its agent is
 * already gone. An id that is no longer pending is ignored.
 *
 * @param ctx - Domain context of the hub.
 * @param id - The hub id.
 * @param error - The error.
 */
function failCall(ctx: HubCtx, id: number, error: WireError): void {
  const call = ctx.state.pending.get(id);
  if (call === undefined) return;

  finish(ctx, call, failure(id, error));
}

/**
 * Registers a call in flight under a new hub id: a tools reply counts against that connection's
 * pending calls, and the deadline of the method starts. The caller sends the request with the id.
 *
 * @param ctx - Domain context of the hub.
 * @param target - Who answers: the agent of a session or an editor page connection.
 * @param method - The method, for the deadline.
 * @param params - The params, for the deadline.
 * @param reply - Where the answer goes.
 * @returns The hub id of the call.
 */
export function startCall(
  ctx: HubCtx,
  target: CallTarget,
  method: string,
  params: Json | undefined,
  reply: Reply
): number {
  const { state, config } = ctx;
  const id = state.nextCallId;
  state.nextCallId += 1;

  if (reply.kind === "tools") {
    const tools = toolsConn(state, reply.conn);
    if (tools !== undefined) tools.pending += 1;
  }

  const deadline = deadlineFor(method, params, config.callTimeoutMs);
  const timer = setTimeout(() => failCall(ctx, id, timedOut()), deadline);
  state.pending.set(id, { id, target, timer, reply });

  return id;
}

/**
 * Forwards a game-channel request to the session's agent under a new hub id, with a deadline.
 * A tools reply counts against that connection's pending calls. A session whose agent is gone
 * answers -32001 `game_reloaded` at once.
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
  const target: CallTarget = { kind: "agent", session: session.id };
  const id = startCall(ctx, target, method, params, reply);

  const agent = ctx.state.conns.get(session.conn);
  if (agent?.kind === "agent") sendJson(agent, request(id, "game", method, params));
  else failCall(ctx, id, gameReloaded());
}

/**
 * Settles a response to a pending call. With `from`, only a call of that target settles: an agent
 * answers the calls of its session, an editor page the calls relayed to it (A3). An unknown id
 * (late after a timeout, or a call of another target) is ignored and logged at debug level.
 *
 * @param ctx - Domain context of the hub.
 * @param response - The response.
 * @param from - The answering agent session or page connection.
 */
export function settle(ctx: HubCtx, response: RpcResponse, from?: CallTarget): void {
  const call = ctx.state.pending.get(response.id);
  if (call === undefined || (from !== undefined && !sameTarget(call.target, from))) {
    ctx.log.debug("hub:late-response", { id: response.id });
    return;
  }

  finish(ctx, call, response);
}

/**
 * Fails every pending agent call of a session with -32001 `game_reloaded` (retryable); calls of
 * other sessions and calls relayed to an editor page keep waiting (A3).
 *
 * @param ctx - Domain context of the hub.
 * @param id - The session id.
 */
export function failSession(ctx: HubCtx, id: string): void {
  const target: CallTarget = { kind: "agent", session: id };
  for (const call of ctx.state.pending.values()) {
    if (sameTarget(call.target, target)) finish(ctx, call, failure(call.id, gameReloaded()));
  }
}

/**
 * Fails every call relayed to an editor page connection with -32001 `page_closed` (retryable);
 * the calls of other pages and of agents keep waiting (A3).
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The closed page connection number.
 */
export function failPage(ctx: HubCtx, conn: number): void {
  const target: CallTarget = { kind: "page", conn };
  for (const call of ctx.state.pending.values()) {
    if (sameTarget(call.target, target)) finish(ctx, call, failure(call.id, pageClosed()));
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
