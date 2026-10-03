/**
 * @file hub plugin — requests of a tools page connection: game-channel requests are checked
 * (session, id in the manifest, input) before they are forwarded to the agent; files-channel
 * requests go to the files plugin. At most 256 pending calls per connection.
 */
import { filesPlugin } from "../../files";
import type {
  CommandDescriptor,
  InputSchema,
  Json,
  Message,
  Request as RpcRequest,
  SourceDescriptor,
  SubId
} from "../../registry/protocol";
import {
  checkInput,
  errorCode,
  failure,
  isRequest,
  success,
  toWireError,
  toWireValue,
  wireError
} from "../../registry/protocol";
import { discardReplies, forward } from "../routing/calls";
import { dispatchFiles } from "../routing/files";
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
 * Checks a SubId: a safe integer ≥ 0 (R6).
 *
 * @param sub - The checked number.
 * @returns The sub.
 * @throws {Error} -32602 naming the field `sub`.
 * @example
 * ```ts
 * const sub = checkSub(params.sub);
 * ```
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
 * @example
 * ```ts
 * call(ctx, conn, req);
 * ```
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
 * @example
 * ```ts
 * watchRequest(ctx, conn, req);
 * ```
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
 * @example
 * ```ts
 * routeGame(ctx, conn, req);
 * ```
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
 * @example
 * ```ts
 * routeFiles(ctx, conn, req);
 * ```
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
 * Routes one request by channel.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 * @throws {Error} A wire error for the response.
 * @example
 * ```ts
 * route(ctx, conn, req);
 * ```
 */
function route(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  if (conn.pending >= MAX_PENDING) throw invalidRequest("too many pending calls");

  if (req.channel === "game") routeGame(ctx, conn, req);
  else if (req.channel === "files") routeFiles(ctx, conn, req);
  else throw unknownMethod(`${req.channel}.${req.method}`);
}

/**
 * One decoded message of a tools connection. Requests are answered (errors through
 * toWireError, never a stack); notifications and responses from tools are ignored.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param message - The decoded message.
 * @example
 * ```ts
 * onToolsMessage(ctx, conn, decode(text));
 * ```
 */
export function onToolsMessage(ctx: HubCtx, conn: ToolsConn, message: Message): void {
  if (!isRequest(message)) {
    ctx.log.debug("hub:tools-ignored", { method: "method" in message ? message.method : "" });
    return;
  }

  try {
    route(ctx, conn, message);
  } catch (error) {
    sendJson(conn, failure(message.id, toWireError(error)));
  }
}

/**
 * The tools connection closed: its replies are discarded and its subscriptions dropped.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @example
 * ```ts
 * onToolsClose(ctx, conn);
 * ```
 */
export function onToolsClose(ctx: HubCtx, conn: ToolsConn): void {
  discardReplies(ctx.state, conn.conn);
  dropToolsConn(ctx, conn);
}
