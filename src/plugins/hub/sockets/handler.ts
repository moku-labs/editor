/**
 * @file hub plugin — the one websocket handler of the server (Bun allows one): open registers a
 * connection of the upgrade's kind, message refuses binary frames and decodes text, close ends
 * agent sessions and tools subscriptions, drain flushes the tools backlog.
 */
import type { Message } from "../../registry/protocol";
import { decode } from "../../registry/protocol";
import { replayPublished } from "../routing/publish";
import { sessionsNotification } from "../routing/sessions";
import type { HubCtx, HubSocket, HubWebSocketHandler, ToolsConn } from "../types";
import { onAgentClose, onAgentMessage } from "./agent";
import { flushBacklog, sendJson, strike, toolsConn } from "./send";
import { onToolsClose, onToolsMessage } from "./tools";

/**
 * The largest frame: 32 MiB, since captures travel as data URLs.
 */
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Seconds without traffic before Bun closes a socket (Bun sends pings).
 */
const IDLE_TIMEOUT_S = 60;

/**
 * Close code of an unsupported frame type.
 */
const UNSUPPORTED_DATA = 1003;

/**
 * Close code of a server that is going away (here: a socket that opens after stop).
 */
const GOING_AWAY = 1001;

/**
 * Decodes a text frame, or undefined when it is not a valid message.
 *
 * @param text - The frame text.
 * @returns The message, or undefined.
 * @example
 * ```ts
 * tryDecode("{nope"); // undefined
 * ```
 */
function tryDecode(text: string): Message | undefined {
  try {
    return decode(text);
  } catch {
    return undefined;
  }
}

/**
 * Registers a new connection; a tools page (an editor page with `role=page` too) gets
 * `sessions {list}` at once, then every published value. A socket that opens after stop is closed
 * with 1001.
 *
 * @param ctx - Domain context of the hub.
 * @param ws - The socket.
 */
function openConn(ctx: HubCtx, ws: HubSocket): void {
  const { state } = ctx;
  if (state.token === undefined) {
    ws.close(GOING_AWAY, "editor stopping");
    return;
  }

  const { kind, conn } = ws.data;
  ctx.log.debug("hub:open", { kind, conn });
  if (kind === "agent") {
    state.conns.set(conn, { kind, conn, socket: ws, session: undefined, bye: false, invalid: 0 });
    return;
  }

  const tools: ToolsConn = {
    kind,
    conn,
    socket: ws,
    page: ws.data.page === true,
    subs: new Map(),
    pending: 0,
    congested: false,
    backlog: new Map(),
    invalid: 0
  };
  state.conns.set(conn, tools);
  sendJson(tools, sessionsNotification(state));
  replayPublished(state, tools);
}

/**
 * One frame: binary closes 1003, an undecodable text is a strike, a message goes to its kind.
 *
 * @param ctx - Domain context of the hub.
 * @param ws - The socket.
 * @param frame - The frame.
 */
function onFrame(ctx: HubCtx, ws: HubSocket, frame: string | Uint8Array): void {
  const conn = ctx.state.conns.get(ws.data.conn);
  if (conn === undefined) return;

  if (typeof frame !== "string") {
    ws.close(UNSUPPORTED_DATA, "binary frames are not accepted");
    return;
  }

  const message = tryDecode(frame);
  if (message === undefined) strike(conn);
  else if (conn.kind === "agent") onAgentMessage(ctx, conn, message);
  else onToolsMessage(ctx, conn, message);
}

/**
 * A closed socket: forgets the connection, then ends its session or its subscriptions.
 *
 * @param ctx - Domain context of the hub.
 * @param ws - The socket.
 */
function closeConn(ctx: HubCtx, ws: HubSocket): void {
  const conn = ctx.state.conns.get(ws.data.conn);
  if (conn === undefined) return;

  ctx.state.conns.delete(conn.conn);
  ctx.log.debug("hub:close", { kind: conn.kind, conn: conn.conn });
  if (conn.kind === "agent") onAgentClose(ctx, conn);
  else onToolsClose(ctx, conn);
}

/**
 * Creates the hub's websocket handler (`websocket` of the Bun.serve options).
 *
 * @param ctx - Domain context of the hub.
 * @returns The handler.
 */
export function createSocketHandler(ctx: HubCtx): HubWebSocketHandler {
  return {
    open: ws => {
      openConn(ctx, ws);
    },
    message: (ws, frame) => {
      onFrame(ctx, ws, frame);
    },
    close: ws => {
      closeConn(ctx, ws);
    },
    drain: ws => {
      const conn = toolsConn(ctx.state, ws.data.conn);
      if (conn !== undefined) flushBacklog(conn);
    },
    maxPayloadLength: MAX_PAYLOAD_BYTES,
    idleTimeout: IDLE_TIMEOUT_S,
    perMessageDeflate: false
  };
}
