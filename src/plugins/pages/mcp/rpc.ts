/**
 * @file pages/mcp — newline-delimited JSON-RPC 2.0 over stdin and stdout (M1). One JSON message
 * per line, no batches. stdout carries only protocol frames; logs go to stderr.
 */
import type { Json } from "../../registry/protocol";
import type { Incoming, JsonObject, JsonShaped, McpId, OutgoingFrame } from "./types";

/**
 * JSON-RPC error codes of the MCP side.
 */
export const rpcCode = {
  parseError: -32_700,
  invalidRequest: -32_600,
  methodNotFound: -32_601,
  invalidParams: -32_602,
  internalError: -32_603
} as const;

/**
 * The id of an error answer that has no request id (a parse error).
 */
// eslint-disable-next-line unicorn/no-null -- JSON-RPC answers a parse error with id null
const NO_ID = null;

/**
 * True for a decoded JSON object (not null, not an array).
 *
 * @param value - A decoded value.
 * @returns Whether it is an object.
 * @example
 * ```ts
 * isObject({ a: 1 }); // true
 * isObject([1]); // false
 * ```
 */
export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a JSON-RPC id the bridge answers: a string or a finite number.
 *
 * @param value - The decoded `id` member.
 * @returns Whether it is an MCP id.
 * @example
 * ```ts
 * isId(7); // true
 * isId(null); // false
 * ```
 */
function isId(value: Json | undefined): value is McpId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/**
 * Parses one line; JSON.parse answers only JSON values.
 *
 * @param line - The line without its newline.
 * @returns The value, or undefined when the line is not JSON.
 * @example
 * ```ts
 * parseJson('{"a":1}'); // { a: 1 }
 * parseJson("{"); // undefined
 * ```
 */
function parseJson(line: string): Json | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * The error answer of a message that cannot be dispatched.
 *
 * @param id - The message id, when it had a usable one.
 * @param message - What is wrong.
 * @param code - The JSON-RPC code (default -32600 invalid request).
 * @returns The classified line.
 * @example
 * ```ts
 * invalid(undefined, "batches are not supported");
 * ```
 */
function invalid(
  id: McpId | undefined,
  message: string,
  code: number = rpcCode.invalidRequest
): Incoming {
  return { kind: "invalid", id, code, message };
}

/**
 * Classifies a decoded JSON-RPC object: request, notification, response or invalid.
 *
 * @param message - The decoded object.
 * @returns The classified message.
 * @example
 * ```ts
 * classify({ jsonrpc: "2.0", method: "ping", id: 1 }); // { kind: "request", request: { id: 1, method: "ping", params: undefined } }
 * ```
 */
function classify(message: JsonObject): Incoming {
  const { id, method, params } = message;
  const knownId = isId(id) ? id : undefined;
  if (message.jsonrpc !== "2.0") return invalid(knownId, 'jsonrpc must be "2.0"');
  if (method === undefined) return { kind: "response" };
  if (typeof method !== "string" || method === "") {
    return invalid(knownId, "method must be a non-empty string");
  }
  if (params !== undefined && !isObject(params)) {
    return invalid(knownId, "params must be an object", rpcCode.invalidParams);
  }

  const checkedParams = isObject(params) ? params : undefined;
  if (id === undefined) {
    return { kind: "notification", notification: { method, params: checkedParams } };
  }
  if (knownId === undefined) return invalid(undefined, "id must be a string or a number");
  return { kind: "request", request: { id: knownId, method, params: checkedParams } };
}

/**
 * Classifies one stdin line.
 *
 * @param line - The line without its newline.
 * @returns A request, a notification, a response (ignored: the bridge sends no requests) or an
 * invalid line with its JSON-RPC error.
 * @example
 * ```ts
 * parseLine('{"jsonrpc":"2.0","id":1,"method":"ping"}').kind; // "request"
 * parseLine("not json"); // { kind: "invalid", id: undefined, code: -32700, message: "parse error" }
 * ```
 */
export function parseLine(line: string): Incoming {
  const value = parseJson(line);
  if (value === undefined) {
    return { kind: "invalid", id: undefined, code: rpcCode.parseError, message: "parse error" };
  }
  if (Array.isArray(value)) return invalid(undefined, "batches are not supported");
  if (!isObject(value)) return invalid(undefined, "a message must be an object");
  return classify(value);
}

/**
 * A success response.
 *
 * @param id - The request id.
 * @param result - The result.
 * @returns The frame.
 * @example
 * ```ts
 * resultFrame(1, {}); // { jsonrpc: "2.0", id: 1, result: {} }
 * ```
 */
export function resultFrame(id: McpId, result: JsonShaped): OutgoingFrame {
  return { jsonrpc: "2.0", id, result };
}

/**
 * An error response; a message without a usable id is answered with id null.
 *
 * @param id - The request id, or undefined.
 * @param code - The JSON-RPC error code.
 * @param message - What is wrong.
 * @returns The frame.
 * @example
 * ```ts
 * errorFrame(3, -32_601, "method not found: tools/delete");
 * ```
 */
export function errorFrame(id: McpId | undefined, code: number, message: string): OutgoingFrame {
  return { jsonrpc: "2.0", id: id ?? NO_ID, error: { code, message } };
}

/**
 * A notification from the bridge to the client.
 *
 * @param method - The method, such as "notifications/progress".
 * @param params - The params, when any.
 * @returns The frame.
 * @example
 * ```ts
 * notificationFrame("notifications/tools/list_changed");
 * ```
 */
export function notificationFrame(method: string, params?: JsonObject): OutgoingFrame {
  return params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params };
}

/**
 * The stdout text of one frame: its JSON on one line, then a newline.
 *
 * @param frame - The frame.
 * @returns The text to write.
 * @example
 * ```ts
 * frameText(resultFrame(1, {})); // '{"jsonrpc":"2.0","id":1,"result":{}}\n'
 * ```
 */
export function frameText(frame: OutgoingFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Reads stdin to its end and calls `onLine` with every non-empty line (a trailing `\r` is
 * dropped, a last line without a newline still counts).
 *
 * @param input - The chunks of stdin.
 * @param onLine - Called with each line.
 * @returns Resolves when stdin ends.
 * @example
 * ```ts
 * await readLines(process.stdin, line => server.handleLine(line));
 * ```
 */
export async function readLines(
  input: AsyncIterable<Uint8Array | string>,
  onLine: (line: string) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffered = "";

  /**
   * Hands every complete line of the buffer to `onLine` and keeps the rest.
   */
  const flush = (): void => {
    let end = buffered.indexOf("\n");
    while (end !== -1) {
      const line = buffered.slice(0, end).replace(/\r$/, "");
      buffered = buffered.slice(end + 1);
      if (line.trim() !== "") onLine(line);
      end = buffered.indexOf("\n");
    }
  };

  for await (const chunk of input) {
    buffered += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    flush();
  }
  buffered += decoder.decode();
  if (buffered.trim() !== "") onLine(buffered.replace(/\r$/, ""));
}
