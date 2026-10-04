/**
 * @file hub plugin — messages of an agent (game page) connection: `hello` first (else close
 * 1008), heartbeats, values, taps, bye, responses to forwarded calls; any request is answered
 * -32007 `unauthorized` (R6). On close the session ends: pending calls fail -32001 and tools are
 * told.
 */
import type { Json, Manifest, Message, Notification, Tap } from "../../registry/protocol";
import {
  errorCode,
  failure,
  isRequest,
  isResponse,
  notification,
  toWireError,
  wireError
} from "../../registry/protocol";
import { settle } from "../routing/calls";
import {
  announce,
  closeSession,
  isManifest,
  openSession,
  readHeartbeat,
  recordHeartbeat,
  sessionParams
} from "../routing/sessions";
import { onAgentValue } from "../routing/subscriptions";
import type { AgentConn, HubCtx, Session } from "../types";
import { sendDroppable, sendJson, strike, toolsConns } from "./send";

/**
 * Policy-violation close code.
 */
const POLICY_VIOLATION = 1008;

/**
 * The `manifest` member of hello params when it is a valid manifest.
 *
 * @param params - The hello params.
 * @returns The manifest, or undefined.
 * @example
 * ```ts
 * manifestOf({ manifest }); // manifest
 * ```
 */
function manifestOf(params: Json | undefined): Manifest | undefined {
  const manifest =
    typeof params === "object" && params !== null && !Array.isArray(params)
      ? params.manifest
      : undefined;
  return isManifest(manifest) ? manifest : undefined;
}

/**
 * The first message: a valid `hello` notification on channel `game` opens the session and tells
 * the agent its id on channel `editor` (R6), then announces it; anything else, a `hello` on another
 * channel included, closes 1008 `hello first`.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param message - The decoded message.
 */
function onHello(ctx: HubCtx, conn: AgentConn, message: Message): void {
  if (
    isResponse(message) ||
    isRequest(message) ||
    message.channel !== "game" ||
    message.method !== "hello"
  ) {
    conn.socket.close(POLICY_VIOLATION, "hello first");
    return;
  }

  const manifest = manifestOf(message.params);
  if (manifest === undefined) {
    conn.socket.close(POLICY_VIOLATION, "bad manifest");
    return;
  }

  const session = openSession(ctx, conn, manifest);
  const payload = { id: session.id, game: manifest.game, open: true };
  sendJson(conn, notification("editor", "session", sessionParams(payload)));
  ctx.log.info("hub:session-open", { id: session.id, game: manifest.game });
  announce(ctx, payload);
}

/**
 * A heartbeat: stored (a silent session comes back) and forwarded to every tools connection
 * with the session (dropped while a connection is congested). A malformed one is a strike.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param session - Its session.
 * @param note - The heartbeat notification.
 */
function onHeartbeat(ctx: HubCtx, conn: AgentConn, session: Session, note: Notification): void {
  const beat = readHeartbeat(note.params);
  if (beat === undefined) {
    strike(conn);
    return;
  }

  recordHeartbeat(ctx, session, beat, Date.now());
  const forwarded = notification("game", "heartbeat", { ...beat }, session.id);
  for (const tools of toolsConns(ctx.state)) sendDroppable(tools, forwarded);
}

/**
 * A value `{sub, value}` of an agent watch; fanned out to the subscribers. A malformed one is a
 * strike.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param session - Its session.
 * @param note - The value notification.
 */
function onValue(ctx: HubCtx, conn: AgentConn, session: Session, note: Notification): void {
  const { params } = note;
  const fields =
    typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
  const { sub, value } = fields;
  if (typeof sub !== "number" || value === undefined) {
    strike(conn);
    return;
  }

  onAgentValue(ctx, session, sub, value);
}

/**
 * Reads a tap: finite `x`, `y` and `at`; other fields are left out.
 *
 * @param params - The tap params.
 * @returns A fresh Tap, or undefined when malformed.
 * @example
 * ```ts
 * readTap({ x: 206, y: 640, at: 15234.5 }); // { x: 206, y: 640, at: 15234.5 }
 * readTap({ x: "206", y: 640, at: 1 }); // undefined
 * ```
 */
function readTap(params: Json | undefined): Tap | undefined {
  const fields =
    typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
  const { x, y, at } = fields;

  return typeof x === "number" &&
    typeof y === "number" &&
    typeof at === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(at)
    ? { x, y, at }
    : undefined;
}

/**
 * A tap `{x, y, at}` of the game page: forwarded to every tools connection with the session, the
 * way a heartbeat is (dropped while a connection is congested). A malformed one is a strike.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param session - Its session.
 * @param note - The tap notification.
 */
function onTap(ctx: HubCtx, conn: AgentConn, session: Session, note: Notification): void {
  const tap = readTap(note.params);
  if (tap === undefined) {
    strike(conn);
    return;
  }

  const forwarded = notification("game", "tap", tap, session.id);
  for (const tools of toolsConns(ctx.state)) sendDroppable(tools, forwarded);
}

/**
 * A notification after hello: heartbeat, value, tap, bye; a second hello closes 1008.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param session - Its session.
 * @param note - The notification.
 */
function onNotification(ctx: HubCtx, conn: AgentConn, session: Session, note: Notification): void {
  switch (note.channel === "game" ? note.method : "") {
    case "hello": {
      conn.socket.close(POLICY_VIOLATION, "hello twice");
      return;
    }
    case "heartbeat": {
      onHeartbeat(ctx, conn, session, note);
      return;
    }
    case "value": {
      onValue(ctx, conn, session, note);
      return;
    }
    case "tap": {
      onTap(ctx, conn, session, note);
      return;
    }
    case "bye": {
      conn.bye = true;
      return;
    }
    default: {
      ctx.log.debug("hub:unknown-notification", { channel: note.channel, method: note.method });
    }
  }
}

/**
 * One decoded message of an agent connection.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param message - The decoded message.
 */
export function onAgentMessage(ctx: HubCtx, conn: AgentConn, message: Message): void {
  if (conn.session === undefined) {
    onHello(ctx, conn, message);
    return;
  }

  const session = ctx.state.sessions.get(conn.session);
  if (session === undefined) return;

  if (isResponse(message)) {
    settle(ctx, message, session.id);
  } else if (isRequest(message)) {
    const refused = wireError(errorCode.unauthorized, "agents cannot send requests", {
      reason: "unauthorized",
      retryable: false
    });
    sendJson(conn, failure(message.id, toWireError(refused)));
  } else {
    onNotification(ctx, conn, session, message);
  }
}

/**
 * The agent connection closed: its session ends with reason `bye` after a bye notification,
 * else `game_reloaded`.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 */
export function onAgentClose(ctx: HubCtx, conn: AgentConn): void {
  if (conn.session === undefined) return;

  closeSession(ctx, conn.session, conn.bye ? "bye" : "game_reloaded");
}
