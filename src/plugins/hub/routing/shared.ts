/**
 * @file hub plugin — the bookkeeping of shared agent-side watches that never forwards: settling
 * the agent's watch answer for every waiting subscriber, detaching subscribers and finding the
 * watch of an agent sub. Kept apart from subscriptions.ts so calls.ts can settle watches without
 * an import cycle.
 */
import type { Response as RpcResponse, SubId } from "../../registry/protocol";
import { failure, isFailure, success } from "../../registry/protocol";
import { JSON_NULL, sendJson, toolsConn } from "../sockets/send";
import type { HubCtx, HubState, SharedSub } from "../types";

/**
 * Removes every subscriber of a shared watch from its tools connection (subs and backlog).
 *
 * @param ctx - Domain context of the hub.
 * @param shared - The shared watch.
 */
export function detach(ctx: HubCtx, shared: SharedSub): void {
  for (const [conn, subs] of shared.subscribers) {
    const tools = toolsConn(ctx.state, conn);
    if (tools === undefined) continue;
    for (const sub of subs) {
      tools.subs.delete(sub);
      tools.backlog.delete(sub);
    }
  }
  shared.subscribers.clear();
}

/**
 * Answers every waiting watch request of a shared watch and empties the waiting list.
 *
 * @param ctx - Domain context of the hub.
 * @param shared - The shared watch.
 * @param response - The answer (its id is replaced by each tools id).
 */
export function answerWaiting(ctx: HubCtx, shared: SharedSub, response: RpcResponse): void {
  for (const { conn, toolsId } of shared.waiting.splice(0)) {
    const tools = toolsConn(ctx.state, conn);
    if (tools === undefined) continue;
    sendJson(
      tools,
      isFailure(response) ? failure(toolsId, response.error) : success(toolsId, JSON_NULL)
    );
  }
}

/**
 * Settles the agent's answer to a shared watch: success makes it ready and answers `null` to
 * every waiting request; an error goes to every waiting request, their subs are removed and the
 * key is forgotten. An unknown key (already removed) is ignored.
 *
 * @param ctx - Domain context of the hub.
 * @param key - The subKey of the watch.
 * @param response - The agent's response.
 */
export function settleWatch(ctx: HubCtx, key: string, response: RpcResponse): void {
  const shared = ctx.state.shared.get(key);
  if (shared === undefined) return;

  if (isFailure(response)) {
    ctx.state.shared.delete(key);
    detach(ctx, shared);
  } else {
    shared.ready = true;
  }
  answerWaiting(ctx, shared, response);
}

/**
 * The shared watch of an agent sub of a session, or undefined.
 *
 * @param state - Hub state.
 * @param session - Session id.
 * @param agentSub - The agent-side sub.
 * @returns The shared watch.
 */
export function findShared(
  state: HubState,
  session: string,
  agentSub: SubId
): SharedSub | undefined {
  for (const shared of state.shared.values()) {
    if (shared.session === session && shared.agentSub === agentSub) return shared;
  }
  return undefined;
}
