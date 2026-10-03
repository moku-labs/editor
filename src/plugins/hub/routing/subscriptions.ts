/**
 * @file hub plugin — watch fan-out: one agent-side watch per (session, source, input) shared by
 * any number of tools subscribers. The first watch forwards; later ones join, get `null` and the
 * last value; the last unwatch forwards an agent unwatch. No throttle of its own (the bridge
 * throttles frame sources, R6).
 */
import type { Json, SubId, WatchParams } from "../../registry/protocol";
import { success } from "../../registry/protocol";
import { JSON_NULL, sendJson, sendValue, toolsConn } from "../sockets/send";
import type { HubCtx, Session, SharedSub, ToolsConn } from "../types";
import { discard, discardWatchCalls, forward } from "./calls";
import { answerWaiting, detach, findShared } from "./shared";

/**
 * JSON with object keys sorted recursively, so equal inputs give equal text.
 *
 * @param value - A Json value.
 * @returns The canonical JSON text.
 * @example
 * ```ts
 * canonical({ b: 1, a: 2 }); // '{"a":2,"b":1}'
 * ```
 */
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  const members = Object.entries(value)
    .toSorted(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
  return `{${members.join(",")}}`;
}

/**
 * The key of a shared watch: session, source id and canonical input, NUL-separated.
 *
 * @param session - Session id.
 * @param sourceId - Source id.
 * @param input - Source input (`null` for none).
 * @returns The key.
 * @example
 * ```ts
 * subKey("s-7f3a", "game.history", { last: 20 }); // 's-7f3a\u0000game.history\u0000{"last":20}'
 * ```
 */
export function subKey(session: string, sourceId: string, input: Json | null): string {
  return `${session}\u0000${sourceId}\u0000${canonical(input)}`;
}

/**
 * Adds a tools subscriber `(conn, sub)` to a shared watch.
 *
 * @param shared - The shared watch.
 * @param conn - Tools connection number.
 * @param sub - Tools sub id.
 */
function addSubscriber(shared: SharedSub, conn: number, sub: SubId): void {
  const subs = shared.subscribers.get(conn);
  if (subs === undefined) shared.subscribers.set(conn, new Set([sub]));
  else subs.add(sub);
}

/**
 * Joins an existing shared watch: ready → `null` then the last value; else wait for the agent.
 *
 * @param conn - The tools connection.
 * @param toolsId - The watch request id.
 * @param sub - The tools sub id.
 * @param shared - The shared watch.
 */
function join(conn: ToolsConn, toolsId: number, sub: SubId, shared: SharedSub): void {
  addSubscriber(shared, conn.conn, sub);
  if (!shared.ready) {
    shared.waiting.push({ conn: conn.conn, toolsId });
    return;
  }

  sendJson(conn, success(toolsId, JSON_NULL));
  if (shared.last !== undefined) sendValue(conn, sub, shared.session, shared.last);
}

/**
 * A tools watch: joins the shared watch of its key, or creates it and forwards one agent watch
 * with a fresh agent sub. Checks (source id, input, duplicate sub) happen before.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param toolsId - The watch request id.
 * @param session - The chosen session.
 * @param params - The checked watch params.
 */
export function watch(
  ctx: HubCtx,
  conn: ToolsConn,
  toolsId: number,
  session: Session,
  params: WatchParams
): void {
  const input = params.input ?? JSON_NULL;
  const key = subKey(session.id, params.id, input);
  conn.subs.set(params.sub, key);

  const existing = ctx.state.shared.get(key);
  if (existing !== undefined) {
    join(conn, toolsId, params.sub, existing);
    return;
  }

  const agentSub = session.nextSub;
  session.nextSub += 1;
  ctx.state.shared.set(key, {
    key,
    session: session.id,
    agentSub,
    sourceId: params.id,
    input,
    ready: false,
    waiting: [{ conn: conn.conn, toolsId }],
    subscribers: new Map([[conn.conn, new Set([params.sub])]]),
    last: undefined
  });

  const forwarded =
    params.input === undefined
      ? { sub: agentSub, id: params.id }
      : { sub: agentSub, id: params.id, input: params.input };
  forward(ctx, session, "watch", forwarded, { kind: "watch", key });
}

/**
 * Removes a shared watch whose last subscriber left: a not-ready one answers its waiting
 * requests with `null` and discards the agent's pending answer; the agent gets one unwatch.
 *
 * @param ctx - Domain context of the hub.
 * @param shared - The shared watch.
 */
function removeShared(ctx: HubCtx, shared: SharedSub): void {
  ctx.state.shared.delete(shared.key);
  if (!shared.ready) {
    discardWatchCalls(ctx.state, shared.key);
    answerWaiting(ctx, shared, success(0, JSON_NULL));
  }

  const session = ctx.state.sessions.get(shared.session);
  if (session !== undefined) forward(ctx, session, "unwatch", { sub: shared.agentSub }, discard());
}

/**
 * A tools unwatch (an unknown sub is fine): removes `(conn, sub)`; the last subscriber gone
 * removes the shared watch.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param sub - The tools sub id.
 */
export function unwatch(ctx: HubCtx, conn: ToolsConn, sub: SubId): void {
  const key = conn.subs.get(sub);
  if (key === undefined) return;

  conn.subs.delete(sub);
  conn.backlog.delete(sub);
  const shared = ctx.state.shared.get(key);
  if (shared === undefined) return;

  const subs = shared.subscribers.get(conn.conn);
  subs?.delete(sub);
  if (subs?.size === 0) shared.subscribers.delete(conn.conn);
  if (shared.subscribers.size === 0) removeShared(ctx, shared);
}

/**
 * A `value` from the agent: stored as the last value and sent to every subscriber with its own
 * tools sub. Values arriving before the watch answer are delivered too.
 *
 * @param ctx - Domain context of the hub.
 * @param session - The agent's session.
 * @param agentSub - The agent-side sub.
 * @param value - The value.
 */
export function onAgentValue(ctx: HubCtx, session: Session, agentSub: SubId, value: Json): void {
  const shared = findShared(ctx.state, session.id, agentSub);
  if (shared === undefined) return;

  shared.last = value;
  for (const [conn, subs] of shared.subscribers) {
    const tools = toolsConn(ctx.state, conn);
    if (tools === undefined) continue;
    for (const sub of subs) sendValue(tools, sub, session.id, value);
  }
}

/**
 * A closed tools connection: every sub is unwatched and its waiting entries are dropped.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 */
export function dropToolsConn(ctx: HubCtx, conn: ToolsConn): void {
  for (const sub of conn.subs.keys()) unwatch(ctx, conn, sub);
  for (const shared of ctx.state.shared.values()) {
    shared.waiting = shared.waiting.filter(entry => entry.conn !== conn.conn);
  }
}

/**
 * A closed session: every shared watch of it is forgotten and removed from its tools subscribers.
 *
 * @param ctx - Domain context of the hub.
 * @param session - The session.
 */
export function dropSession(ctx: HubCtx, session: Session): void {
  for (const shared of ctx.state.shared.values()) {
    if (shared.session !== session.id) continue;
    ctx.state.shared.delete(shared.key);
    detach(ctx, shared);
  }
}
