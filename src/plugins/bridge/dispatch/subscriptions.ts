/**
 * @file bridge plugin — subscriptions of the hub: followed through `channel.watch` for edge and
 * commit sources, re-read once per heartbeat for frame sources (R6, D-15), re-read after each
 * run, and sent only when the value changed. A run that changed an edge or commit value opens its
 * channel watch again, so the door's next frame is compared with the value sent last.
 */
import type { Json, Request as RpcRequest, SubId } from "../../registry/protocol";
import { errorCode, failure, success, toWireError, wireError } from "../../registry/protocol";
import type { BridgeDeps, Subscription } from "../types";
import type { CheckedParams } from "./params";
import { congested, messageOf, sendNow, sendValue } from "./send";

/**
 * The JSON null the watch response carries.
 */
// eslint-disable-next-line unicorn/no-null -- null is the result of watch on the wire
const ACK: Json = null;

/**
 * Answers a request with the wire error of a thrown value.
 *
 * @param deps - The domain deps.
 * @param request - The request.
 * @param error - What was thrown.
 * @example
 * ```ts
 * answerError(deps, request, error);
 * ```
 */
function answerError(deps: BridgeDeps, request: RpcRequest, error: unknown): void {
  sendNow(deps, failure(request.id, toWireError(error)));
}

/**
 * True while `record` is still the subscription of its sub id.
 *
 * @param deps - The domain deps.
 * @param record - A subscription.
 * @returns Whether it was neither replaced nor removed.
 * @example
 * ```ts
 * if (isCurrent(deps, record)) pushValue(deps, record.sub, value);
 * ```
 */
function isCurrent(deps: Pick<BridgeDeps, "state">, record: Subscription): boolean {
  return deps.state.subs.get(record.sub) === record;
}

/**
 * Follows an edge or commit subscription again after a run changed its value: a new channel
 * watch replaces the old one, and its first value is the one sent. The channel drops the door's
 * first frame when it repeats that value, so the comparison is always with the value sent last,
 * never with the value of subscribe time. An unchanged value changes nothing. A failed re-open
 * keeps the old watch, logs at debug and sends the value read.
 *
 * @param deps - The domain deps.
 * @param record - The edge or commit subscription.
 * @param value - The value the post-run read returned.
 * @example
 * ```ts
 * refollow(deps, record, { path: "visit/enter" }); // sends it; the next frame's "home" follows
 * ```
 */
function refollow(deps: BridgeDeps, record: Subscription, value: Json): void {
  if (JSON.stringify(value) === record.lastSent) return;
  const previous = record.stop;
  try {
    record.stop = deps.channel.watch(record.id, record.input, next => {
      if (isCurrent(deps, record)) pushValue(deps, record.sub, next);
    });
  } catch (error) {
    deps.log.debug("bridge:refresh-failed", {
      sub: record.sub,
      id: record.id,
      message: messageOf(error)
    });
    pushValue(deps, record.sub, value);
    return;
  }
  previous?.();
}

/**
 * Reads the source of a subscription again: a frame value is pushed, an edge or commit value
 * follows the channel again when it changed (`refollow`). A read error is logged at debug and the
 * subscription stays.
 *
 * @param deps - The domain deps.
 * @param record - The subscription.
 * @param event - The debug event of a failed read.
 * @example
 * ```ts
 * reread(deps, record, "bridge:sample-failed");
 * ```
 */
function reread(deps: BridgeDeps, record: Subscription, event: string): void {
  deps.channel.read(record.id, record.input).then(
    value => {
      if (!isCurrent(deps, record)) return;
      if (record.changes === "frame") pushValue(deps, record.sub, value);
      else refollow(deps, record, value);
    },
    (error: unknown) => {
      deps.log.debug(event, { sub: record.sub, id: record.id, message: messageOf(error) });
    }
  );
}

/**
 * A frame source: one read now, answered with null and pushed; later re-read per heartbeat.
 *
 * @param deps - The domain deps.
 * @param request - The watch request.
 * @param record - The new subscription (stop undefined).
 * @example
 * ```ts
 * await followFrames(deps, request, record);
 * ```
 */
async function followFrames(
  deps: BridgeDeps,
  request: RpcRequest,
  record: Subscription
): Promise<void> {
  deps.state.subs.set(record.sub, record);
  let value: Json;
  try {
    value = await deps.channel.read(record.id, record.input);
  } catch (error) {
    if (isCurrent(deps, record)) deps.state.subs.delete(record.sub);
    answerError(deps, request, error);
    return;
  }
  sendNow(deps, success(request.id, ACK));
  if (isCurrent(deps, record)) pushValue(deps, record.sub, value);
}

/**
 * An edge or commit source: `channel.watch`, whose immediate value waits until the response
 * (null) is on the socket.
 *
 * @param deps - The domain deps.
 * @param request - The watch request.
 * @param record - The new subscription.
 * @example
 * ```ts
 * followDoor(deps, request, record);
 * ```
 */
function followDoor(deps: BridgeDeps, request: RpcRequest, record: Subscription): void {
  const buffer: Json[] = [];
  let acked = false;

  /**
   * Holds values until the response is sent, then pushes them while the subscription lives.
   *
   * @param value - A value of the channel watch.
   * @example
   * ```ts
   * deliver({ path: "home" });
   * ```
   */
  const deliver = (value: Json): void => {
    if (!acked) buffer.push(value);
    else if (isCurrent(deps, record)) pushValue(deps, record.sub, value);
  };

  try {
    record.stop = deps.channel.watch(record.id, record.input, deliver);
  } catch (error) {
    answerError(deps, request, error);
    return;
  }
  deps.state.subs.set(record.sub, record);
  sendNow(deps, success(request.id, ACK));
  acked = true;
  for (const value of buffer) pushValue(deps, record.sub, value);
}

/**
 * Serves a `watch` request: replaces a subscription with the same sub, answers -32601 for an
 * unknown source, then follows the source (edge, commit) or samples it (frame). The response
 * precedes the first value.
 *
 * @param deps - The domain deps.
 * @param request - The watch request (answered exactly once).
 * @param params - Its checked params.
 * @example
 * ```ts
 * await subscribe(deps, request, { sub: 1, id: "game.position" });
 * ```
 */
export async function subscribe(
  deps: BridgeDeps,
  request: RpcRequest,
  params: CheckedParams<"watch">
): Promise<void> {
  const { sub, id, input } = params;
  if (deps.state.subs.has(sub)) unsubscribe(deps, sub);

  const entry = deps.registry.source(id);
  if (entry === undefined) {
    answerError(
      deps,
      request,
      wireError(errorCode.unknownMethod, `${id}: unknown source`, {
        reason: "unknown_id",
        retryable: false,
        id
      })
    );
    return;
  }

  const { changes } = entry.descriptor;
  const record: Subscription = { sub, id, input, changes, stop: undefined, lastSent: undefined };
  if (changes === "frame") {
    await followFrames(deps, request, record);
    return;
  }
  followDoor(deps, request, record);
}

/**
 * Ends a subscription: stops its channel watch, forgets it and its backlog value. An unknown sub
 * is fine.
 *
 * @param deps - The state.
 * @param sub - The subscription id.
 * @example
 * ```ts
 * unsubscribe(deps, 1);
 * ```
 */
export function unsubscribe(deps: Pick<BridgeDeps, "state">, sub: SubId): void {
  const { state } = deps;
  state.subs.get(sub)?.stop?.();
  state.subs.delete(sub);
  state.pending.delete(sub);
}

/**
 * Ends every subscription (socket closed, stop).
 *
 * @param deps - The state.
 * @example
 * ```ts
 * dropAll({ state });
 * ```
 */
export function dropAll(deps: Pick<BridgeDeps, "state">): void {
  const { state } = deps;
  for (const record of state.subs.values()) record.stop?.();
  state.subs.clear();
  state.pending.clear();
}

/**
 * Heartbeat tick: re-reads every frame subscription and sends what changed. Skipped while the
 * socket is congested.
 *
 * @param deps - The domain deps.
 * @example
 * ```ts
 * channel.onHeartbeat(() => sampleFrames(deps));
 * ```
 */
export function sampleFrames(deps: BridgeDeps): void {
  const { socket, subs } = deps.state;
  if (socket !== undefined && congested(socket)) return;
  for (const record of subs.values()) {
    if (record.changes === "frame") reread(deps, record, "bridge:sample-failed");
  }
}

/**
 * After a run settles: re-reads every subscription and sends what changed (a paused game or a
 * hidden tab runs no frames, so door watches would miss what the command changed, R6). An edge or
 * commit value that changed opens its channel watch again (`refollow`).
 *
 * @param deps - The domain deps.
 * @example
 * ```ts
 * await channel.run(id, input).finally(() => refreshAll(deps));
 * ```
 */
export function refreshAll(deps: BridgeDeps): void {
  for (const record of deps.state.subs.values()) reread(deps, record, "bridge:refresh-failed");
}

/**
 * Sends a value of a subscription unless it equals the last one sent (JSON text).
 *
 * @param deps - The state and the log.
 * @param sub - The subscription id.
 * @param value - The value.
 * @example
 * ```ts
 * pushValue(deps, 1, { path: "board/awaitIntent" });
 * ```
 */
export function pushValue(deps: Pick<BridgeDeps, "state" | "log">, sub: SubId, value: Json): void {
  const record = deps.state.subs.get(sub);
  if (record === undefined) return;
  const text = JSON.stringify(value);
  if (text === record.lastSent) return;
  sendValue(deps, sub, value, text);
}
