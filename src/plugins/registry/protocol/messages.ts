/**
 * @file Protocol — encode, decode, the message builders and the message guards.
 */
import { errorCode, wireError } from "./errors";
import type {
  Channel,
  ErrorReason,
  Json,
  Message,
  Notification,
  Request,
  Response,
  WireError,
  WireErrorData
} from "./types";

/**
 * A decoded JSON object.
 */
type JsonObject = { [key: string]: Json };

/**
 * The longest method name a message may carry.
 */
const MAX_METHOD_LENGTH = 128;

/**
 * Every error reason, so a decoded `data.reason` is checked against the type.
 */
const REASONS: Readonly<Record<ErrorReason, true>> = {
  game_reloaded: true,
  no_session: true,
  choose_session: true,
  timeout: true,
  invalid_input: true,
  unknown_id: true,
  command_failed: true,
  not_json: true,
  forbidden_path: true,
  version_conflict: true,
  unauthorized: true,
  link_closed: true
};

/**
 * Builds the -32600 error of a malformed message.
 *
 * @param message - What is wrong, without the prefix.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw malformed("message must be an object");
 * ```
 */
function malformed(message: string): Error {
  return wireError(errorCode.invalidRequest, message, { retryable: false });
}

/**
 * True for a decoded JSON object (not null, not an array).
 *
 * @param value - A decoded value.
 * @returns Whether `value` is a JSON object.
 * @example
 * ```ts
 * isObject({ a: 1 }); // true
 * ```
 */
function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for one of the three logical channels.
 *
 * @param value - A decoded value.
 * @returns Whether `value` is "game", "files" or "editor".
 * @example
 * ```ts
 * isChannel("files"); // true
 * ```
 */
function isChannel(value: Json | undefined): value is Channel {
  return value === "game" || value === "files" || value === "editor";
}

/**
 * True for a known error reason.
 *
 * @param value - A decoded value.
 * @returns Whether `value` is an ErrorReason.
 * @example
 * ```ts
 * isErrorReason("timeout"); // true
 * ```
 */
function isErrorReason(value: Json | undefined): value is ErrorReason {
  return typeof value === "string" && Object.hasOwn(REASONS, value);
}

/**
 * Parses the text; every value JSON.parse returns is a Json value.
 *
 * @param text - The received text.
 * @returns The parsed value.
 * @throws {Error} -32600 when the text is not JSON.
 * @example
 * ```ts
 * parse('{"a":1}'); // { a: 1 }
 * ```
 */
function parse(text: string): Json {
  try {
    return JSON.parse(text);
  } catch {
    throw malformed("message is not JSON");
  }
}

/**
 * Copies the known `data` keys of a decoded error when their types are right.
 *
 * @param data - The decoded data object.
 * @returns A fresh WireErrorData.
 * @example
 * ```ts
 * dataOf({ reason: "timeout", retryable: true, stack: "x" }); // { retryable: true, reason: "timeout" }
 * ```
 */
function dataOf(data: JsonObject): WireErrorData {
  const copy: WireErrorData = {};

  if (typeof data.retryable === "boolean") copy.retryable = data.retryable;
  if (isErrorReason(data.reason)) copy.reason = data.reason;
  if (typeof data.id === "string") copy.id = data.id;
  if (typeof data.field === "string") copy.field = data.field;

  return copy;
}

/**
 * Checks and copies the `error` member of a response.
 *
 * @param value - The decoded `error` member.
 * @returns A fresh WireError.
 * @throws {Error} -32600 when it is not `{ code: integer, message: string, data?: object }`.
 * @example
 * ```ts
 * errorOf({ code: -32_601, message: "[moku-editor] unknown id" });
 * ```
 */
function errorOf(value: Json): WireError {
  if (!isObject(value)) throw malformed("error must have a code and a message");

  const { code, message, data } = value;

  if (typeof code !== "number" || !Number.isInteger(code) || typeof message !== "string") {
    throw malformed("error must have a code and a message");
  }

  const error: WireError = { code, message };

  if (data === undefined) return error;
  if (!isObject(data)) throw malformed("error must have a code and a message");

  error.data = dataOf(data);

  return error;
}

/**
 * Checks the members every message kind may carry: params, session and id.
 *
 * @param parsed - The decoded object.
 * @returns The checked params, session and id.
 * @throws {Error} -32600 naming the first bad member.
 * @example
 * ```ts
 * membersOf({ jsonrpc: "2.0", id: 1, result: null }); // { params: undefined, session: undefined, id: 1 }
 * ```
 */
function membersOf(parsed: JsonObject): {
  params: Json | undefined;
  session: string | undefined;
  id: number | undefined;
} {
  const { params, session, id } = parsed;

  if (params !== undefined && (typeof params !== "object" || params === null)) {
    throw malformed("params must be an object or an array");
  }
  if (session !== undefined && (typeof session !== "string" || session === "")) {
    throw malformed("session must be a non-empty string");
  }
  if (id !== undefined && (typeof id !== "number" || !Number.isSafeInteger(id))) {
    throw malformed("id must be an integer");
  }

  return { params, session, id };
}

/**
 * Checks `method` and `channel` of a request or a notification.
 *
 * @param parsed - The decoded object.
 * @returns The method and the channel, or undefined when there is no `method` (a response).
 * @throws {Error} -32600 when the method or the channel is bad.
 * @example
 * ```ts
 * callOf({ jsonrpc: "2.0", channel: "game", method: "bye" }); // { method: "bye", channel: "game" }
 * ```
 */
function callOf(parsed: JsonObject): { method: string; channel: Channel } | undefined {
  const { method, channel } = parsed;

  if (method === undefined) return undefined;
  if (typeof method !== "string" || method === "" || method.length > MAX_METHOD_LENGTH) {
    throw malformed("method must be a non-empty string");
  }
  if (!isChannel(channel)) throw malformed("channel must be game, files or editor");

  return { method, channel };
}

/**
 * Builds the response of a decoded object without `method`.
 *
 * @param parsed - The decoded object.
 * @param id - Its checked id.
 * @returns A fresh Response.
 * @throws {Error} -32600 when the id is missing or the result/error rule fails.
 * @example
 * ```ts
 * responseOf({ jsonrpc: "2.0", id: 3, result: null }, 3); // { jsonrpc: "2.0", id: 3, result: null }
 * ```
 */
function responseOf(parsed: JsonObject, id: number | undefined): Response {
  if (id === undefined) throw malformed("a response needs an id");

  const { result, error } = parsed;

  if (result !== undefined && error === undefined) return success(id, result);
  if (result !== undefined || error === undefined) {
    throw malformed("a response has exactly one of result and error");
  }

  return failure(id, errorOf(error));
}

/**
 * Encodes a message to JSON text.
 *
 * @param message - Any wire message.
 * @returns The JSON text.
 * @example
 * ```ts
 * socket.send(encode(notification("game", "heartbeat", beat)));
 * ```
 */
export function encode(message: Message): string {
  return JSON.stringify(message);
}

/**
 * Decodes and validates a message; returns a fresh object with the known keys; throws -32600.
 *
 * @param text - The received text.
 * @returns A Request (method and id), a Notification (method, no id) or a Response.
 * @throws {Error} A ProtocolError -32600 naming what is wrong; it cannot be answered.
 * @example
 * ```ts
 * decode('{"jsonrpc":"2.0","channel":"game","method":"bye"}'); // { jsonrpc: "2.0", channel: "game", method: "bye" }
 * ```
 */
export function decode(text: string): Message {
  const parsed = parse(text);

  if (Array.isArray(parsed)) throw malformed("batches are not supported");
  if (!isObject(parsed)) throw malformed("message must be an object");
  if (parsed.jsonrpc !== "2.0") throw malformed('jsonrpc must be "2.0"');

  const call = callOf(parsed);
  const { params, session, id } = membersOf(parsed);

  if (call === undefined) return responseOf(parsed, id);

  return id === undefined
    ? notification(call.channel, call.method, params, session)
    : request(id, call.channel, call.method, params, session);
}

/**
 * Builds a request (undefined keys omitted).
 *
 * @param id - Request id.
 * @param channel - Logical channel.
 * @param method - Method name.
 * @param params - Optional params.
 * @param session - Optional session id (game channel).
 * @returns The request.
 * @example
 * ```ts
 * request(7, "game", "run", { id: "game.step", input: { frames: 1 } }, "s-7f3a");
 * ```
 */
export function request(
  id: number,
  channel: Channel,
  method: string,
  params?: Json,
  session?: string
): Request {
  const message: Request = { jsonrpc: "2.0", id, channel, method };

  if (params !== undefined) message.params = params;
  if (session !== undefined) message.session = session;

  return message;
}

/**
 * Builds a notification (undefined keys omitted).
 *
 * @param channel - Logical channel.
 * @param method - Method name.
 * @param params - Optional params.
 * @param session - Optional session id.
 * @returns The notification.
 * @example
 * ```ts
 * notification("game", "bye"); // { jsonrpc: "2.0", channel: "game", method: "bye" }
 * ```
 */
export function notification(
  channel: Channel,
  method: string,
  params?: Json,
  session?: string
): Notification {
  const message: Notification = { jsonrpc: "2.0", channel, method };

  if (params !== undefined) message.params = params;
  if (session !== undefined) message.session = session;

  return message;
}

/**
 * Builds a success response.
 *
 * @param id - The request id.
 * @param result - The result.
 * @returns The response.
 * @example
 * ```ts
 * success(7, null); // { jsonrpc: "2.0", id: 7, result: null }
 * ```
 */
export function success(id: number, result: Json): Response {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Builds an error response.
 *
 * @param id - The request id.
 * @param error - The wire error.
 * @returns The response.
 * @example
 * ```ts
 * failure(7, toWireError(error));
 * ```
 */
export function failure(id: number, error: WireError): Response {
  return { jsonrpc: "2.0", id, error };
}

/**
 * True for a request (has `method` and `id`).
 *
 * @param message - A decoded message.
 * @returns Whether it is a request.
 * @example
 * ```ts
 * if (isRequest(message)) handleRequest(message);
 * ```
 */
export function isRequest(message: Message): message is Request {
  return "method" in message && "id" in message;
}

/**
 * True for a notification (has `method`, no `id`).
 *
 * @param message - A decoded message.
 * @returns Whether it is a notification.
 * @example
 * ```ts
 * if (isNotification(message)) route(message.method);
 * ```
 */
export function isNotification(message: Message): message is Notification {
  return "method" in message && !("id" in message);
}

/**
 * True for a response (no `method`).
 *
 * @param message - A decoded message.
 * @returns Whether it is a response.
 * @example
 * ```ts
 * if (isResponse(message)) settle(message);
 * ```
 */
export function isResponse(message: Message): message is Response {
  return !("method" in message);
}

/**
 * True for an error response.
 *
 * @param response - A response.
 * @returns Whether it carries an error.
 * @example
 * ```ts
 * if (isFailure(response)) reject(fromWireError(response.error));
 * ```
 */
export function isFailure(response: Response): response is Extract<Response, { error: WireError }> {
  return "error" in response;
}
