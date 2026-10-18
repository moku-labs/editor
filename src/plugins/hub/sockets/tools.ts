/**
 * @file hub plugin — messages of a tools page connection: game-channel requests are checked
 * (session, id in the manifest, input) before they are forwarded to the agent, a `run` stamped with
 * the hub's `from` and `client` for an agent whose hello named `run-from` (spec 11 § 5.1); files-channel requests go to the files plugin;
 * editor-channel requests answer the kept selection, are relayed to the editor page (`select`,
 * `device`, `show`, `node`: one table, each with the protocol parser of its params, D-60), or run an
 * editor method another server plugin registered (H2). An editor page (`role=page`, D-33) also
 * sends its `selection` and answers relayed calls; a plain tools client (the MCP bridge) names its
 * MCP client with `client { name }`; other notifications and responses are ignored. At most 256
 * pending calls per connection.
 */
import type { FilesApi } from "../../files/types";
import type {
  CommandDescriptor,
  EditorRequests,
  InputSchema,
  Json,
  Message,
  Notification,
  RelayedEditorMethod,
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
  parseDeviceParams,
  parseNodeParams,
  parseSelectParams,
  parseShowParams,
  success,
  toWireError,
  toWireValue,
  wireError
} from "../../registry/protocol";
import { CLIENT_METHOD, clientNameOf } from "../protocol";
import { discardReplies, forward, runParamsOf, settle } from "../routing/calls";
import { callEditorMethod } from "../routing/editor-methods";
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
 * Params of `read`.
 */
const CALL = { id: "string", input: "json?" } satisfies InputSchema;

/**
 * Params of `run`: `from` and `client` are taken (any value) and never forwarded: the hub stamps
 * its own.
 */
const RUN = { id: "string", input: "json?", from: "json?", client: "json?" } satisfies InputSchema;

/**
 * Params of `watch`.
 */
const WATCH = { sub: "number", id: "string", input: "json?" } satisfies InputSchema;

/**
 * Params of `unwatch`.
 */
const UNWATCH = { sub: "number" } satisfies InputSchema;

/**
 * How the hub checks one request it relays to the editor page.
 */
type RelayCheck<M extends RelayedEditorMethod> = {
  /** The protocol parser of the params: a fresh checked copy, or undefined when they do not fit. */
  readonly parse: (value: unknown) => EditorRequests[M]["params"] | undefined;
  /** The params shape, as the -32602 message prints it. */
  readonly shape: string;
};

/**
 * The editor-channel requests the hub relays to the editor page (D-33, D-60), each with the check
 * of its params. A method that is not a key here is not relayed.
 */
const RELAYED: { readonly [M in RelayedEditorMethod]: RelayCheck<M> } = {
  select: {
    parse: parseSelectParams,
    shape: "{ key?: string, ref?: SelectionRef, rect?: SelectionRect, card?: boolean }"
  },
  device: {
    parse: parseDeviceParams,
    shape: '{ preset?: string, orientation?: "portrait" | "landscape", folded?: boolean }'
  },
  show: { parse: parseShowParams, shape: "{ workspace?: WorkspaceName }" },
  node: { parse: parseNodeParams, shape: "{ id: string (1 to 256 chars) }" }
};

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
 * True for an editor-channel method the hub relays to the editor page: an own key of `RELAYED`, so
 * a name every object inherits is not one.
 *
 * @param method - The request method.
 * @returns Whether the method is relayed.
 * @example
 * ```ts
 * isRelayed("device"); // true
 * isRelayed("selection"); // false: the hub answers it itself
 * isRelayed("constructor"); // false
 * ```
 */
function isRelayed(method: string): method is RelayedEditorMethod {
  return Object.hasOwn(RELAYED, method);
}

/**
 * The -32602 error of relayed params that do not fit the shape of their method.
 *
 * @param method - The relayed method.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * invalidRelayParams("node").message;
 * // "[moku-editor] editor.node params must be { id: string (1 to 256 chars) }"
 * ```
 */
function invalidRelayParams(method: RelayedEditorMethod): Error {
  return wireError(
    errorCode.invalidInput,
    `editor.${method} params must be ${RELAYED[method].shape}`,
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
 * Checks that the id names a source (read, watch) or a command (run) in the session's manifest,
 * and that the input fits its descriptor.
 *
 * @param session - The chosen session.
 * @param method - "read", "watch" or "run".
 * @param id - The source or command id.
 * @param input - The request input.
 * @returns {void} Nothing; it throws when the id is unknown or the input is wrong.
 * @throws {Error} -32601 `unknown_id` (data.id) or -32602 from checkInput.
 * @example
 * ```ts
 * checkTarget(session, "run", "game.step", { frames: 1 }); // passes
 * checkTarget(session, "run", "game.nope", {}); // throws "[moku-editor] unknown command game.nope"
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
 * A `read`: checked, then forwarded as sent with the tools id as reply target.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 */
function read(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  const { id, input } = checkInput(CALL, req.params ?? {});
  const session = chooseSession(ctx, req.session);
  checkTarget(session, "read", id, input);

  forward(ctx, session, "read", req.params, { kind: "tools", conn: conn.conn, toolsId: req.id });
}

/**
 * A `run`: checked, stamped with the hub's `from` and `client` when the session's agent named
 * `run-from` in its hello (whatever the tools client wrote there is dropped either way), then
 * forwarded with the tools id as reply target.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 */
function run(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  const { id, input } = checkInput(RUN, req.params ?? {});
  const session = chooseSession(ctx, req.session);
  checkTarget(session, "run", id, input);

  const params = runParamsOf({ id, input }, conn, session.caps);
  forward(ctx, session, "run", params, { kind: "tools", conn: conn.conn, toolsId: req.id });
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
    case "read": {
      read(ctx, conn, req);
      return;
    }
    case "run": {
      run(ctx, conn, req);
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
 * @param files - The files api, resolved once with the socket handler.
 * @param conn - The tools connection.
 * @param req - The request.
 */
function routeFiles(ctx: HubCtx, files: FilesApi, conn: ToolsConn, req: RpcRequest): void {
  conn.pending += 1;
  dispatchFiles(files, req.method, req.params)
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
 * A request relayed to the editor page: the params are checked with the parser of the method, then
 * the checked copy goes to the page, whose answer comes back with the tools id. Absent params are
 * checked as `{}`.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 * @param method - The method of the request, known to be relayed.
 * @throws {Error} -32602 `invalid_input` for params that do not fit (nothing is relayed), -32003
 * `no_editor_page` when no page is open.
 */
function relayToPage(
  ctx: HubCtx,
  conn: ToolsConn,
  req: RpcRequest,
  method: RelayedEditorMethod
): void {
  const params = RELAYED[method].parse(req.params ?? {});
  if (params === undefined) throw invalidRelayParams(method);

  forwardToPage(ctx, method, toWireValue(params), {
    kind: "tools",
    conn: conn.conn,
    toolsId: req.id
  });
}

/**
 * An editor-channel request, in this order: `selection` answers the kept selection (`null` when
 * none, never forwarded); `select`, `device`, `show` and `node` are checked and relayed to the
 * editor page, whose answer comes back with the tools id; a method another server plugin registered
 * runs (H2); anything else is -32601.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The request.
 * @throws {Error} A wire error for the response: -32602, -32003 `no_editor_page`, -32601.
 */
function routeEditor(ctx: HubCtx, conn: ToolsConn, req: RpcRequest): void {
  const { method } = req;

  if (method === "selection") {
    checkInput(NO_PARAMS, req.params ?? {});
    sendJson(conn, success(req.id, ctx.state.published.get("selection") ?? JSON_NULL));
    return;
  }
  if (isRelayed(method)) {
    relayToPage(ctx, conn, req, method);
    return;
  }

  const handler = ctx.state.editorMethods.get(method);
  if (handler === undefined) throw unknownMethod(`editor.${method}`);
  callEditorMethod(ctx, conn, req, handler);
}

/**
 * Routes one request by channel.
 *
 * @param ctx - Domain context of the hub.
 * @param files - The files api, resolved once with the socket handler.
 * @param conn - The tools connection.
 * @param req - The request.
 * @throws {Error} A wire error for the response.
 */
function route(ctx: HubCtx, files: FilesApi, conn: ToolsConn, req: RpcRequest): void {
  if (conn.pending >= MAX_PENDING) throw invalidRequest("too many pending calls");

  if (req.channel === "game") routeGame(ctx, conn, req);
  else if (req.channel === "files") routeFiles(ctx, files, conn, req);
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
 * True for the editor-channel `client` notification (the MCP bridge names its MCP client).
 *
 * @param message - A decoded message.
 * @returns Whether it is the client notification.
 * @example
 * ```ts
 * isClientNote({ jsonrpc: "2.0", channel: "editor", method: "client", params: { name: "Claude Code" } }); // true
 * ```
 */
function isClientNote(message: Message): message is Notification {
  return (
    isNotification(message) && message.channel === "editor" && message.method === CLIENT_METHOD
  );
}

/**
 * The `name` member of notification params, as it arrived.
 *
 * @param params - The params.
 * @returns The member, or undefined when the params are no object.
 * @example
 * ```ts
 * nameIn({ name: "Claude Code" }); // "Claude Code"
 * ```
 */
function nameIn(params: Json | undefined): Json | undefined {
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? params.name
    : undefined;
}

/**
 * One decoded message of a tools connection. Requests are answered (errors through
 * toWireError, never a stack). An editor page's responses settle the calls relayed to it and its
 * `selection` is published; a plain tools client's `client` names it (cleaned by `clientNameOf`,
 * last value wins, an empty name clears it); every other notification or response, the editor
 * page's `client` included, is ignored (debug log).
 *
 * @param ctx - Domain context of the hub.
 * @param files - The files api, resolved once with the socket handler.
 * @param conn - The tools connection.
 * @param message - The decoded message.
 */
export function onToolsMessage(
  ctx: HubCtx,
  files: FilesApi,
  conn: ToolsConn,
  message: Message
): void {
  if (isRequest(message)) {
    try {
      route(ctx, files, conn, message);
    } catch (error) {
      sendJson(conn, failure(message.id, toWireError(error)));
    }
    return;
  }

  if (conn.page && isResponse(message)) {
    settle(ctx, message, { kind: "page", conn: conn.conn });
  } else if (conn.page && isSelectionNote(message)) {
    receiveSelection(ctx, conn, message.params);
  } else if (!conn.page && isClientNote(message)) {
    conn.client = clientNameOf(nameIn(message.params));
    ctx.log.debug("hub:tools-client", { conn: conn.conn, client: conn.client });
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
