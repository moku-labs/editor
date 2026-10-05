/**
 * @file hub plugin — messages of a tools page connection: game-channel requests are checked
 * (session, id in the manifest, input) before they are forwarded to the agent; files-channel
 * requests go to the files plugin; editor-channel requests answer the kept selection or are
 * relayed to the editor page. An editor page (`role=page`, D-33) also sends its `selection` and
 * answers relayed calls; other notifications and responses are ignored. At most 256 pending calls
 * per connection.
 */
import { filesPlugin } from "../../files";
import type {
  CommandDescriptor,
  InputSchema,
  Json,
  Message,
  Notification,
  Request as RpcRequest,
  SourceDescriptor,
  SubId
} from "../../registry/protocol";
import {
  checkInput,
  errorCode,
  failure,
  isNotification,
  isRequest,
  isResponse,
  parseSelectParams,
  success,
  toWireError,
  toWireValue,
  wireError
} from "../../registry/protocol";
import { discardReplies, forward, settle } from "../routing/calls";
import { dispatchFiles } from "../routing/files";
import { closePage, forwardToPage, receiveSelection } from "../routing/pages";
import { chooseSession } from "../routing/sessions";
import { dropToolsConn, unwatch, watch } from "../routing/subscriptions";
import type { HubCtx, Session, ToolsConn } from "../types";
import { JSON_NULL, sendJson } from "./send";

/**
 * The most calls one tools connection may have in flight.
 */
const MAX_PENDING = 256;

/**
 * Params of `manifest`.
 */
const NO_PARAMS = {} satisfies InputSchema;

/**
 * Params of `read` and `run`.
 */
const CALL = { id: "string", input: "json?" } satisfies InputSchema;

/**
 * Params of `watch`.
 */
const WATCH = { sub: "number", id: "string", input: "json?" } satisfies InputSchema;

/**
 * Params of `unwatch`.
 */
const UNWATCH = { sub: "number" } satisfies InputSchema;

/**
 * The -32601 error of an unknown method or channel.
 *
 * @param name - `channel.method`.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw unknownMethod("game.eval");
 * ```
 */
function unknownMethod(name: string): Error {
  return wireError(errorCode.unknownMethod, `unknown method ${name}`, { retryable: false });
}

/**
 * The -32600 error of a request the hub refuses as a whole.
 *
 * @param message - What is wrong.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw invalidRequest("too many pending calls");
 * ```
 */
function invalidRequest(message: string): Error {
  return wireError(errorCode.invalidRequest, message, { retryable: false });
}

/**
 * The -32602 error of `editor.select` params that do not fit SelectParams.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw invalidSelectParams();
 * ```
 */
function invalidSelectParams(): Error {
  return wireError(
    errorCode.invalidInput,
    "editor.select params must be { key?: string, ref?: SelectionRef, rect?: SelectionRect, card?: boolean }",
    { reason: "invalid_input", retryable: false }
  );
}

/**
 * Checks a SubId: a safe integer ≥ 0 (R6).
 *
 * @param sub - The checked number.
 * @returns The sub.
 * @throws {Error} -32602 naming the field `sub`.
 */
function checkSub(sub: number): SubId {
  if (Number.isSafeInteger(sub) && sub >= 0) return sub;

  throw wireError(errorCode.invalidInput, "sub must be a safe integer of at least 0", {
    reason: "invalid_input",
    retryable: false,
    field: "sub"
  });
}

/**
 * The descriptor of a source (read, watch) or command (run) in the session's manifest, with its
 * input checked.
 *
 * @param session - The chosen session.
 * @param method - "read", "watch" or "run".
 * @param id - The source or command id.
 * @param input - The request input.
 * @throws {Error} -32601 `unknown_id` (data.id) or -32602 from checkInput.
 * @example
 * ```ts
 * checkTarget(session, "run", "game.step", { frames: 1 });
 * ```
 */
function checkTarget(session: Session, method: string, id: string, input: Json | undefined): void {
  const list: readonly (SourceDescriptor | CommandDescriptor)[] =
    method === "run" ? session.manifest.commands : session.manifest.sources;
  const descriptor = list.find(entry => entry.id === id);
  if (descriptor === undefined) {
    const kind = method === "run" ? "command" : "source";
    throw wireError(errorCode.unknownMethod, `unknown ${kind} ${id}`, {
      reason: "unknown_id",
      retryable: false,
      id
    });
  }

  checkInput(descriptor.input, input ?? {});
}

/**
 * A `read` or `run`: checked, then forwarded with the tools id as reply target.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 */
function call(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  const { id, input } = checkInput(CALL, req.params ?? {});
  const session = chooseSession(ctx, req.session);
  checkTarget(session, req.method, id, input);

  forward(ctx, session, req.method, req.params, {
    kind: "tools",
    conn: conn.conn,
    toolsId: req.id
  });
}

/**
 * A `watch`: checked (sub, source, input, a sub not yet used on this connection), then joined
 * to its shared watch.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 */
function watchRequest(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  const params = checkInput(WATCH, req.params ?? {});
  const sub = checkSub(params.sub);
  const session = chooseSession(ctx, req.session);
  checkTarget(session, "watch", params.id, params.input);
  if (conn.subs.has(sub)) throw invalidRequest(`sub ${sub} is already watched`);

  const checked =
    params.input === undefined
      ? { sub, id: params.id }
      : { sub, id: params.id, input: params.input };
  watch(ctx, conn, req.id, session, checked);
}

/**
 * A game-channel request.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 * @throws {Error} A wire error for the response.
 */
function routeGame(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  switch (req.method) {
    case "manifest": {
      checkInput(NO_PARAMS, req.params ?? {});
      const { manifest } = chooseSession(ctx, req.session);
      sendJson(conn, success(req.id, toWireValue(manifest)));
      return;
    }
    case "read":
    case "run": {
      call(ctx, conn, req);
      return;
    }
    case "watch": {
      watchRequest(ctx, conn, req);
      return;
    }
    case "unwatch": {
      unwatch(ctx, conn, checkSub(checkInput(UNWATCH, req.params ?? {}).sub));
      sendJson(conn, success(req.id, JSON_NULL));
      return;
    }
    default: {
      throw unknownMethod(`game.${req.method}`);
    }
  }
}

/**
 * A files-channel request: dispatched to the files plugin; answered when it settles, unless the
 * connection closed meanwhile.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 */
function routeFiles(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  conn.pending += 1;
  dispatchFiles(ctx.require(filesPlugin), req.method, req.params)
    .then(
      result => success(req.id, result),
      (error: unknown) => failure(req.id, toWireError(error))
    )
    .then(response => {
      conn.pending -= 1;
      if (ctx.state.conns.get(conn.conn) === conn) sendJson(conn, response);
    });
}

/**
 * An editor-channel request: `selection` answers the kept selection (`null` when none, never
 * forwarded); `select` is checked and relayed to the editor page, whose answer comes back with
 * the tools id.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 * @throws {Error} A wire error for the response: -32602, -32003 `no_editor_page`, -32601.
 */
function routeEditor(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  switch (req.method) {
    case "selection": {
      checkInput(NO_PARAMS, req.params ?? {});
      sendJson(conn, success(req.id, ctx.state.published.get("selection") ?? JSON_NULL));
      return;
    }
    case "select": {
      const params = parseSelectParams(req.params ?? {});
      if (params === undefined) throw invalidSelectParams();
      forwardToPage(ctx, req.method, toWireValue(params), {
        kind: "tools",
        conn: conn.conn,
        toolsId: req.id
      });
      return;
    }
    default: {
      throw unknownMethod(`editor.${req.method}`);
    }
  }
}

/**
 * Routes one request by channel.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 * @throws {Error} A wire error for the response.
 */
function route(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  if (conn.pending >= MAX_PENDING) throw invalidRequest("too many pending calls");

  if (req.channel === "game") routeGame(ctx, conn, req);
  else if (req.channel === "files") routeFiles(ctx, conn, req);
  else routeEditor(ctx, conn, req);
}

/**
 * True for the editor-channel `selection` notification.
 *
 * @param message - A decoded message.
 * @returns Whether it is the selection notification.
 * @example
 * ```ts
 * isSelectionNote({ jsonrpc: "2.0", channel: "editor", method: "selection" }); // true
 * ```
 */
function isSelectionNote(message: Message): message is Notification {
  return isNotification(message) && message.channel === "editor" && message.method === "selection";
}

/**
 * One decoded message of a tools connection. Requests are answered (errors through
 * toWireError, never a stack). An editor page's responses settle the calls relayed to it and its
 * `selection` is published; every other notification or response is ignored (debug log).
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param message - The decoded message.
 */
export function onToolsMessage(ctx: HubCtx, conn: ToolsConn, message: Message): void {
  if (isRequest(message)) {
    try {
      route(ctx, conn, message);
    } catch (error) {
      sendJson(conn, failure(message.id, toWireError(error)));
    }
    return;
  }

  if (conn.page && isResponse(message)) {
    settle(ctx, message, { kind: "page", conn: conn.conn });
  } else if (conn.page && isSelectionNote(message)) {
    receiveSelection(ctx, conn, message.params);
  } else {
    ctx.log.debug("hub:tools-ignored", { method: "method" in message ? message.method : "" });
  }
}

/**
 * The tools connection closed: its replies are discarded and its subscriptions dropped; an
 * editor page also fails the calls relayed to it and may clear the selection.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 */
export function onToolsClose(ctx: HubCtx, conn: ToolsConn): void {
  discardReplies(ctx.state, conn.conn);
  dropToolsConn(ctx, conn);
  if (conn.page) closePage(ctx, conn);
}
