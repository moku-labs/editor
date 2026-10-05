/**
 * @file link plugin — the editor-channel requests the hub relays to the editor page (D-33):
 * `handle` adds the handler of a method; a request runs it and answers its result or its error on
 * the socket it came on, with the hub's id. No handler answers -32601.
 */
import type { Request as RpcRequest, Response as RpcResponse } from "../../registry/protocol";
import {
  encode,
  errorCode,
  failure,
  isWireError,
  parseSelectParams,
  success,
  toWireError,
  toWireValue,
  wireError
} from "../../registry/protocol";
import { describeError } from "../rpc/calls";
import type { LinkCtx, SelectHandler } from "../types";

/**
 * Adds the handler of `select`; it replaces the one before.
 *
 * @param ctx - Domain context of link.
 * @param method - "select".
 * @param handler - Gets the checked params, resolves the selection.
 * @returns An idempotent remover that removes only this handler.
 */
export function addHandler(ctx: LinkCtx, method: "select", handler: SelectHandler): () => void {
  const { handlers } = ctx.state;
  /**
   * A wrapper of `handler`, so a remover never removes a later registration of the same function.
   *
   * @param params - The checked params.
   * @returns The handler's answer.
   */
  const entry: SelectHandler = params => handler(params);

  handlers.set(method, entry);
  return () => {
    if (handlers.get(method) === entry) handlers.delete(method);
  };
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
 * The failure of params that are not SelectParams.
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
 * Runs the handler of a request and builds the response. Never rejects: a thrown error is the
 * failure, logged as `link:request-failed` (see logFailure).
 *
 * @param ctx - Domain context of link.
 * @param request - The editor-channel request.
 * @returns The response with the request's id.
 */
async function answerOf(ctx: LinkCtx, request: RpcRequest): Promise<RpcResponse> {
  const handler = request.method === "select" ? ctx.state.handlers.get("select") : undefined;
  if (handler === undefined) return unknownMethod(request);

  const params = parseSelectParams(request.params ?? {});
  if (params === undefined) return invalidParams(request);

  try {
    return success(request.id, toWireValue(await handler(params)));
  } catch (error) {
    logFailure(ctx, request.method, error);
    return failure(request.id, toWireError(error));
  }
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
