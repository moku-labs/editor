/**
 * @file link plugin — the editor-channel requests the hub relays to the editor page (D-33, D-60):
 * `select`, `device`, `show` and `node`. `handle` adds the handler of a method with the params
 * parser of that method; a request runs the pair of its method and answers its result or its error
 * on the socket it came on, with the hub's id. No handler answers -32601.
 */
import type {
  EditorRequests,
  RelayedEditorMethod,
  Request as RpcRequest,
  Response as RpcResponse
} from "../../registry/protocol";
import {
  encode,
  errorCode,
  failure,
  isWireError,
  parseDeviceParams,
  parseNodeParams,
  parseSelectParams,
  parseShowParams,
  success,
  toWireError,
  toWireValue,
  wireError
} from "../../registry/protocol";
import { describeError } from "../rpc/calls";
import type { LinkCtx, RequestEntry, RequestHandler } from "../types";

/**
 * The params check of a relayed method: fresh checked params, or undefined for a bad shape.
 */
type ParamsParser<M extends RelayedEditorMethod> = (
  value: unknown
) => EditorRequests[M]["params"] | undefined;

/**
 * The params parser of every relayed method. The type is mapped over `RelayedEditorMethod`: a
 * method added there does not compile without its parser, and a parser of another method's params
 * does not fit its row.
 */
const PARSERS: { readonly [M in RelayedEditorMethod]: ParamsParser<M> } = {
  select: parseSelectParams,
  device: parseDeviceParams,
  show: parseShowParams,
  node: parseNodeParams
};

/**
 * True for a method the hub relays to the page: one with a row in `PARSERS`.
 *
 * @param method - The method of a request.
 * @returns Whether the page can have a handler for it.
 * @example
 * ```ts
 * isRelayed("device"); // true
 * isRelayed("selection"); // false: the hub answers it itself
 * ```
 */
function isRelayed(method: string): method is RelayedEditorMethod {
  return Object.hasOwn(PARSERS, method);
}

/**
 * The failure of an editor method this page does not handle.
 *
 * @param request - The request.
 * @returns The -32601 response.
 */
function unknownMethod(request: RpcRequest): RpcResponse {
  const error = wireError(
    errorCode.unknownMethod,
    `unknown method editor.${request.method}: this page has no handler`,
    { retryable: false }
  );
  return failure(request.id, toWireError(error));
}

/**
 * The failure of params the parser of the method refused.
 *
 * @param request - The request.
 * @returns The -32602 `invalid_input` response.
 */
function invalidParams(request: RpcRequest): RpcResponse {
  const error = wireError(errorCode.invalidInput, `editor.${request.method}: bad params`, {
    reason: "invalid_input",
    retryable: false
  });
  return failure(request.id, toWireError(error));
}

/**
 * Logs a handler failure as `link:request-failed`: at debug for invalid input (a caller asked for
 * something the page does not have, e.g. an unknown key: the caller gets the error), at warn for
 * every other failure.
 *
 * @param ctx - Domain context of link.
 * @param method - The request method.
 * @param error - What the handler threw.
 */
function logFailure(ctx: LinkCtx, method: string, error: unknown): void {
  const details = { method, ...describeError(error) };
  if (isWireError(error) && error.code === errorCode.invalidInput) {
    ctx.log.debug("link:request-failed", details);
    return;
  }
  ctx.log.warn("link:request-failed", details);
}

/**
 * Checks the params of a request and runs the handler with them. Missing params are `{}`. Never
 * rejects: a thrown error is the failure, logged as `link:request-failed` (see logFailure).
 *
 * @param ctx - Domain context of link.
 * @param request - The editor-channel request.
 * @param parse - The params parser of the request's method.
 * @param handler - The handler of the request's method.
 * @returns The handler's result, the -32602 response for bad params, or the handler's failure.
 */
async function runHandler<P, R>(
  ctx: LinkCtx,
  request: RpcRequest,
  parse: (value: unknown) => P | undefined,
  handler: (params: P) => R | Promise<R>
): Promise<RpcResponse> {
  const params = parse(request.params ?? {});
  if (params === undefined) return invalidParams(request);

  try {
    return success(request.id, toWireValue(await handler(params)));
  } catch (error) {
    logFailure(ctx, request.method, error);
    return failure(request.id, toWireError(error));
  }
}

/**
 * Adds the handler of a relayed method. It replaces the handler of that method before and leaves
 * the other methods alone.
 *
 * @param ctx - Domain context of link.
 * @param method - "select", "device", "show" or "node".
 * @param handler - Gets the checked params of the method; returns or resolves its result.
 * @returns An idempotent remover that removes only this handler.
 */
export function addHandler<M extends RelayedEditorMethod>(
  ctx: LinkCtx,
  method: M,
  handler: RequestHandler<M>
): () => void {
  const { handlers } = ctx.state;
  const parse: ParamsParser<M> = PARSERS[method];
  /**
   * The handler with the parser of its method. A new function per `handle` call, so a remover
   * never removes a later registration of the same handler.
   *
   * @param current - Domain context of link at the request.
   * @param request - A request of `method`.
   * @returns The response.
   */
  const entry: RequestEntry = (current, request) => runHandler(current, request, parse, handler);

  handlers.set(method, entry);
  return () => {
    if (handlers.get(method) === entry) handlers.delete(method);
  };
}

/**
 * Picks the handler and the parser of a request by its method, as `handle` paired them, and builds
 * the response. A method without a handler, relayed or not, is the -32601 failure.
 *
 * @param ctx - Domain context of link.
 * @param request - The editor-channel request.
 * @returns The response with the request's id.
 */
async function answerOf(ctx: LinkCtx, request: RpcRequest): Promise<RpcResponse> {
  const { method } = request;
  const entry = isRelayed(method) ? ctx.state.handlers.get(method) : undefined;

  return entry === undefined ? unknownMethod(request) : entry(ctx, request);
}

/**
 * Answers an editor-channel request of the hub. The answer goes out only on the socket the request
 * came on, while it is still open: a hub that lost this page failed its call already.
 *
 * @param ctx - Domain context of link.
 * @param request - The request.
 */
export async function onEditorRequest(ctx: LinkCtx, request: RpcRequest): Promise<void> {
  const { state } = ctx;
  const { socket } = state;
  const { method } = request;
  const response = await answerOf(ctx, request);

  if (state.stopped || !state.open || socket === undefined || state.socket !== socket) {
    ctx.log.debug("link:answer-dropped", { method });
    return;
  }
  try {
    socket.send(encode(response));
  } catch {
    ctx.log.warn("link:answer-failed", { method });
  }
}
