/**
 * @file Protocol — encode, decode, the message builders and the message guards.
 */
import type { Channel, Json, Message, Notification, Request, Response, WireError } from "./types";

/**
 * Encodes a message as JSON text.
 *
 * @param _message - Any wire message.
 * @example
 * ```ts
 * socket.send(encode(notification("game", "heartbeat", beat)));
 * ```
 */
export function encode(_message: Message): string {
  throw new Error("not implemented");
}

/**
 * Decodes and validates a message; returns a fresh object with the known keys; throws -32600.
 *
 * @param _text - The received text.
 * @example
 * ```ts
 * const message = decode(event.data);
 * ```
 */
export function decode(_text: string): Message {
  throw new Error("not implemented");
}

/**
 * Builds a request (undefined keys omitted).
 *
 * @param _id - Request id.
 * @param _channel - Logical channel.
 * @param _method - Method name.
 * @param _params - Optional params.
 * @param _session - Optional session id (game channel).
 * @example
 * ```ts
 * request(7, "game", "run", { id: "game.step", input: { frames: 1 } }, "s-7f3a");
 * ```
 */
export function request(
  _id: number,
  _channel: Channel,
  _method: string,
  _params?: Json,
  _session?: string
): Request {
  throw new Error("not implemented");
}

/**
 * Builds a notification (undefined keys omitted).
 *
 * @param _channel - Logical channel.
 * @param _method - Method name.
 * @param _params - Optional params.
 * @param _session - Optional session id.
 * @example
 * ```ts
 * notification("game", "bye");
 * ```
 */
export function notification(
  _channel: Channel,
  _method: string,
  _params?: Json,
  _session?: string
): Notification {
  throw new Error("not implemented");
}

/**
 * Builds a success response.
 *
 * @param _id - The request id.
 * @param _result - The result.
 * @example
 * ```ts
 * success(7, null);
 * ```
 */
export function success(_id: number, _result: Json): Response {
  throw new Error("not implemented");
}

/**
 * Builds an error response.
 *
 * @param _id - The request id.
 * @param _error - The wire error.
 * @example
 * ```ts
 * failure(7, toWireError(error));
 * ```
 */
export function failure(_id: number, _error: WireError): Response {
  throw new Error("not implemented");
}

/**
 * True for a request (has `method` and `id`).
 *
 * @param _message - A decoded message.
 * @example
 * ```ts
 * if (isRequest(message)) handleRequest(message);
 * ```
 */
export function isRequest(_message: Message): _message is Request {
  throw new Error("not implemented");
}

/**
 * True for a notification (has `method`, no `id`).
 *
 * @param _message - A decoded message.
 * @example
 * ```ts
 * if (isNotification(message)) route(message.method);
 * ```
 */
export function isNotification(_message: Message): _message is Notification {
  throw new Error("not implemented");
}

/**
 * True for a response (no `method`).
 *
 * @param _message - A decoded message.
 * @example
 * ```ts
 * if (isResponse(message)) settle(message);
 * ```
 */
export function isResponse(_message: Message): _message is Response {
  throw new Error("not implemented");
}

/**
 * True for an error response.
 *
 * @param _response - A response.
 * @example
 * ```ts
 * if (isFailure(response)) reject(fromWireError(response.error));
 * ```
 */
export function isFailure(
  _response: Response
): _response is Extract<Response, { error: WireError }> {
  throw new Error("not implemented");
}
