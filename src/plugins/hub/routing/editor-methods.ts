/**
 * @file hub plugin — editor-channel methods of other server plugins (spec 11 § 5.1 H2).
 * `addEditorMethods` registers `<plugin>.<verb>` handlers before the server starts (frozen with the
 * routes); the tools socket runs one for an `editor.<name>` request after the hub's own `selection`
 * and its relayed methods. Only tools connections reach this: an agent's or a phone's request is
 * refused -32007 before routing, and the LAN listener has no tools socket (C9). A call counts in the
 * connection's pending calls like a files call; a throw or a rejection is answered as a wire error;
 * the answer is dropped when the connection closed meanwhile.
 */
import type { EditorRequestMethod, Json, Request as RpcRequest } from "../../registry/protocol";
import { failure, success, toWireError } from "../../registry/protocol";
import { sendJson } from "../sockets/send";
import type { EditorMethod, EditorMethods, HubCtx, ToolsConn } from "../types";

/**
 * The editor-channel methods the hub answers or relays itself. Mapped over every editor request,
 * so a new hub method cannot be left out of the refusal.
 */
const HUB_METHODS: { readonly [M in EditorRequestMethod]: true } = {
  selection: true,
  select: true,
  device: true,
  show: true,
  node: true
};

/**
 * The shape of an editor method name: `<plugin>.<verb>`, at least one dot between word parts.
 */
const METHOD_NAME = /^[A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)+$/;

/**
 * A registration error in the spec/11 Part 3 format with the editor prefix (R7).
 *
 * @param problem - What is wrong, without the final period.
 * @param fix - How to fix it, without the final period.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * methodError('hub.addEditorMethods() got the name "connect.scan" twice', "Register each editor method once").message;
 * // '[moku-editor] hub.addEditorMethods() got the name "connect.scan" twice.\n  Register each editor method once.'
 * ```
 */
function methodError(problem: string, fix: string): Error {
  return new Error(`[moku-editor] ${problem}.\n  ${fix}.`);
}

/**
 * Checks one name and its handler against the hub's rules.
 *
 * @param ctx - Domain context of the hub.
 * @param name - The method name.
 * @param handler - Its handler.
 * @throws {Error} For a name of the hub, a name without a dot, or a name registered before.
 * @throws {TypeError} When the handler is not a function.
 */
function checkMethod(ctx: HubCtx, name: string, handler: unknown): void {
  if (Object.hasOwn(HUB_METHODS, name)) {
    throw methodError(
      `hub.addEditorMethods() refuses the name "${name}": the hub answers or relays it itself`,
      'Name the method <plugin>.<verb>, like "connect.scan"'
    );
  }
  if (!METHOD_NAME.test(name)) {
    throw methodError(
      `hub.addEditorMethods() refuses the name "${name}": editor methods are named <plugin>.<verb>`,
      'Use a name like "connect.scan"'
    );
  }
  if (ctx.state.editorMethods.has(name)) {
    throw methodError(
      `hub.addEditorMethods() got the name "${name}" twice`,
      "Register each editor method once"
    );
  }
  if (typeof handler !== "function") {
    throw new TypeError(
      `[moku-editor] hub.addEditorMethods(): "${name}" is not a function.\n  Pass an async handler (params, caller) => Json.`
    );
  }
}

/**
 * Registers editor methods of another server plugin. Every name is checked first, so a refused
 * batch registers nothing.
 *
 * @param ctx - Domain context of the hub.
 * @param methods - Name (`<plugin>.<verb>`) → handler.
 * @throws {Error} After serve() or listenDevices(), for a name of the hub, a name without a dot, or a
 * name registered before.
 * @throws {TypeError} When a handler is not a function.
 */
export function registerEditorMethods(ctx: HubCtx, methods: EditorMethods): void {
  if (ctx.state.routesFrozen) {
    throw methodError(
      "hub.addEditorMethods() ran after hub.serve() or hub.listenDevices()",
      "Register editor methods in onInit, before the server starts"
    );
  }

  const entries = Object.entries(methods);
  for (const [name, handler] of entries) checkMethod(ctx, name, handler);
  for (const [name, handler] of entries) ctx.state.editorMethods.set(name, handler);
}

/**
 * Runs a handler; a synchronous throw becomes a rejection.
 *
 * @param handler - The editor method.
 * @param params - The request params.
 * @param caller - The tools connection that asked.
 * @param caller.conn - Its connection number.
 * @returns The handler's answer.
 */
async function run(
  handler: EditorMethod,
  params: Json | undefined,
  caller: { readonly conn: number }
): Promise<Json> {
  return handler(params, caller);
}

/**
 * Answers a tools request with a registered editor method: counted as pending until it settles,
 * answered with its result or its error as a wire error, unless the connection closed meanwhile.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The tools connection.
 * @param req - The editor-channel request.
 * @param handler - The registered method of its name.
 */
export function callEditorMethod(
  ctx: HubCtx,
  conn: ToolsConn,
  req: RpcRequest,
  handler: EditorMethod
): void {
  conn.pending += 1;
  run(handler, req.params, Object.freeze({ conn: conn.conn }))
    .then(
      result => success(req.id, result),
      (error: unknown) => failure(req.id, toWireError(error))
    )
    .then(response => {
      conn.pending -= 1;
      if (ctx.state.conns.get(conn.conn) === conn) sendJson(conn, response);
    });
}
