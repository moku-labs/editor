/**
 * @file bridge plugin — dispatch of the hub's messages: the `editor`/`session` notification, and
 * every game request answered exactly once, within its deadline (R1, R7).
 */
import type {
  Json,
  Message,
  Notification,
  Request as RpcRequest,
  Response as RpcResponse
} from "../../registry/protocol";
import {
  decode,
  errorCode,
  failure,
  isNotification,
  isRequest,
  success,
  toWireError,
  toWireValue,
  wireError
} from "../../registry/protocol";
import { currentStatus, setStatus } from "../status";
import type { BridgeDeps } from "../types";
import { checkParams, deadlineFor, memberOf } from "./params";
import { messageOf, sendNow } from "./send";
import { refreshAll, subscribe, unsubscribe } from "./subscriptions";

/**
 * The JSON null of an empty result.
 */
// eslint-disable-next-line unicorn/no-null -- null is the result of unwatch on the wire
const NO_RESULT: Json = null;

/**
 * Builds the -32601 error of an unknown method.
 *
 * @param name - `<method>` or `<channel>.<method>`.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw unknownMethod("files.read");
 * ```
 */
function unknownMethod(name: string): Error {
  return wireError(errorCode.unknownMethod, `unknown method ${name}`);
}

/**
 * Answers a request within its deadline: the settle of `work` responds, unless the deadline
 * fired first (-32002 timeout, retryable, R7); a late settle is dropped. The command itself is
 * not cancelled. Resolves when `work` settles.
 *
 * @param deps - The domain deps.
 * @param request - The request.
 * @param id - The source or command id.
 * @param work - The channel call.
 * @returns A promise that settles with `work`, never rejects.
 */
function answerWithin(
  deps: BridgeDeps,
  request: RpcRequest,
  id: string,
  work: Promise<Json>
): Promise<void> {
  const { state } = deps;
  const deadline = deadlineFor(request.method, request.params, deps.config.callTimeoutMs);
  const timer = setTimeout(() => {
    state.inflight.delete(request.id);
    const timeout = wireError(errorCode.timeout, `${id}: no answer after ${String(deadline)} ms`, {
      reason: "timeout",
      retryable: true,
      id
    });
    sendNow(deps, failure(request.id, toWireError(timeout)));
  }, deadline);
  state.inflight.set(request.id, timer);

  /**
   * Responds unless the deadline fired or the socket closed in between.
   *
   * @param response - The response of the settled call.
   */
  const settle = (response: RpcResponse): void => {
    if (state.inflight.get(request.id) !== timer) {
      deps.log.debug("bridge:late-result", { id, request: request.id });
      return;
    }
    clearTimeout(timer);
    state.inflight.delete(request.id);
    sendNow(deps, response);
  };

  return work.then(
    value => {
      settle(success(request.id, value));
    },
    (error: unknown) => {
      settle(failure(request.id, toWireError(error)));
    }
  );
}

/**
 * Serves one game request; throws what should become its error response.
 *
 * @param deps - The domain deps.
 * @param request - The request.
 * @throws {Error} -32601 unknown method, -32602 bad params, or what the registry threw.
 */
async function route(deps: BridgeDeps, request: RpcRequest): Promise<void> {
  const { channel, method, params } = request;
  if (channel !== "game") throw unknownMethod(`${channel}.${method}`);

  switch (method) {
    case "manifest": {
      checkParams("manifest", params);
      sendNow(deps, success(request.id, toWireValue(deps.registry.manifest())));
      return;
    }
    case "read": {
      const { id, input } = checkParams("read", params);
      await answerWithin(deps, request, id, deps.channel.read(id, input));
      return;
    }
    case "watch": {
      await subscribe(deps, request, checkParams("watch", params));
      return;
    }
    case "unwatch": {
      unsubscribe(deps, checkParams("unwatch", params).sub);
      sendNow(deps, success(request.id, NO_RESULT));
      return;
    }
    case "run": {
      const { id, input } = checkParams("run", params);
      await answerWithin(deps, request, id, deps.channel.run(id, input));
      refreshAll(deps);
      return;
    }
    default: {
      throw unknownMethod(method);
    }
  }
}

/**
 * Serves a request of the hub: exactly one response, sent at once; errors become wire errors
 * that keep their code and data, never a stack, and start with `[moku-editor] ` (R1).
 *
 * @param deps - The domain deps.
 * @param request - The decoded request.
 * @returns A promise that settles when the request is served (never rejects in practice).
 */
export async function handleRequest(deps: BridgeDeps, request: RpcRequest): Promise<void> {
  try {
    await route(deps, request);
  } catch (error) {
    sendNow(deps, failure(request.id, toWireError(error)));
  }
}

/**
 * The session after an `editor`/`session` notification: its id when it opened, undefined when
 * our session closed, else unchanged.
 *
 * @param current - The current session.
 * @param id - The notified session id.
 * @param open - The notified `open` flag.
 * @returns The next session.
 * @example
 * ```ts
 * sessionAfter(undefined, "s-7f3a", true); // "s-7f3a"
 * ```
 */
function sessionAfter(
  current: string | undefined,
  id: string,
  open: Json | undefined
): string | undefined {
  if (open === true) return id;
  if (open === false && current === id) return;
  return current;
}

/**
 * Serves a notification of the hub: the `editor`/`session` notification sets or clears the
 * session (R6) and announces it; every other one is ignored.
 *
 * @param deps - The domain deps.
 * @param message - The notification.
 */
function handleNotification(deps: BridgeDeps, message: Notification): void {
  if (message.channel !== "editor" || message.method !== "session") {
    deps.log.debug("bridge:notification-ignored", {
      channel: message.channel,
      method: message.method
    });
    return;
  }
  const id = memberOf(message.params, "id");
  if (typeof id !== "string") return;

  const { state } = deps;
  const next = sessionAfter(state.session, id, memberOf(message.params, "open"));
  if (next === state.session) return;
  state.session = next;
  setStatus(deps, currentStatus(deps), true);
}

/**
 * Handles one socket message: binary ignored, undecodable dropped (no trusted id to answer),
 * responses ignored (the agent sends no requests), notifications and requests served.
 *
 * @param deps - The domain deps.
 * @param data - The `data` of the message event.
 */
export function handleText(deps: BridgeDeps, data: unknown): void {
  if (typeof data !== "string") {
    deps.log.debug("bridge:binary-ignored");
    return;
  }
  let message: Message;
  try {
    message = decode(data);
  } catch (error) {
    deps.log.debug("bridge:bad-message", { message: messageOf(error) });
    return;
  }
  if (isRequest(message)) {
    handleRequest(deps, message).catch((error: unknown) => {
      deps.log.error("bridge:request-crashed", { id: message.id }, asError(error));
    });
  } else if (isNotification(message)) {
    handleNotification(deps, message);
  }
}

/**
 * The Error of a thrown value, for `log.error`.
 *
 * @param error - Anything thrown.
 * @returns The Error, or undefined for anything else.
 * @example
 * ```ts
 * log.error("bridge:connect-crashed", undefined, asError(error));
 * ```
 */
export function asError(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined;
}
