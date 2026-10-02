/**
 * @file Protocol — error codes, the ProtocolError class and the wire-error helpers (R1, R6, R7).
 * Every message the editor builds starts with ERROR_PREFIX. There is no protocolError helper (R7).
 */
import type { WireError, WireErrorData } from "./types";

/**
 * The prefix of every error message the editor throws or returns (R1, R7).
 */
export const ERROR_PREFIX = "[moku-editor] ";

/**
 * JSON-RPC error codes of the editor (contracts §2, R6).
 */
export const errorCode = {
  invalidRequest: -32_600,
  unknownMethod: -32_601,
  invalidInput: -32_602,
  commandFailed: -32_000,
  gameReloaded: -32_001,
  timeout: -32_002,
  noSession: -32_003,
  forbiddenPath: -32_004,
  versionConflict: -32_005,
  notJson: -32_006,
  unauthorized: -32_007
} as const;

/**
 * An Error that is also a WireError: code, message and optional data.
 *
 * @example
 * ```ts
 * throw new ProtocolError(-32_602, "[moku-editor] game.step: frames must be a number", { reason: "invalid_input", field: "frames" });
 * ```
 */
export class ProtocolError extends Error {
  /** Always "ProtocolError". */
  override readonly name = "ProtocolError";
  /** JSON-RPC error code, see errorCode. */
  readonly code: number;
  /** Reason, retryable, id, field. Absent when not given (exactOptionalPropertyTypes). */
  declare readonly data?: WireErrorData;

  /**
   * Builds a protocol error. The message is expected to carry the prefix already.
   *
   * @param code - JSON-RPC error code.
   * @param message - The message, starting with `[moku-editor] `.
   * @param data - Optional data (reason, retryable, id, field).
   * @example
   * ```ts
   * new ProtocolError(-32_001, "[moku-editor] game reloaded", { reason: "game_reloaded", retryable: true });
   * ```
   */
  constructor(code: number, message: string, data?: WireErrorData) {
    super(message);
    this.code = code;
    if (data !== undefined) this.data = data;
  }

  /**
   * The plain WireError of this error (`data` omitted when undefined), without the stack.
   *
   * @returns A fresh `{ code, message, data? }` object.
   * @example
   * ```ts
   * socket.send(encode(failure(id, error.wire)));
   * ```
   */
  get wire(): WireError {
    return plainWire(this, this.message);
  }
}

/**
 * The message that stands in for a thrown value that is not an Error.
 */
const UNKNOWN_ERROR = `${ERROR_PREFIX}Unknown error`;

/**
 * Adds the prefix to a message that lacks it, never twice.
 *
 * @param message - A message, with or without the prefix.
 * @returns The message starting with `[moku-editor] `.
 * @example
 * ```ts
 * withPrefix("boom"); // "[moku-editor] boom"
 * ```
 */
function withPrefix(message: string): string {
  return message.startsWith(ERROR_PREFIX) ? message : `${ERROR_PREFIX}${message}`;
}

/**
 * True for an object that is neither null nor an array.
 *
 * @param value - Anything.
 * @returns Whether `value` is a plain record.
 * @example
 * ```ts
 * isRecord({ reason: "timeout" }); // true
 * ```
 */
function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copies the known data keys (retryable, reason, id, field); every other key is dropped.
 *
 * @param data - The data of a wire error.
 * @returns A fresh data object.
 * @example
 * ```ts
 * copyData({ reason: "timeout", retryable: true }); // { retryable: true, reason: "timeout" }
 * ```
 */
function copyData(data: WireErrorData): WireErrorData {
  const copy: WireErrorData = {};

  if (data.retryable !== undefined) copy.retryable = data.retryable;
  if (data.reason !== undefined) copy.reason = data.reason;
  if (data.id !== undefined) copy.id = data.id;
  if (data.field !== undefined) copy.field = data.field;

  return copy;
}

/**
 * Builds the plain `{ code, message, data? }` of a wire error.
 *
 * @param error - The wire error.
 * @param message - The message to carry.
 * @returns A fresh WireError; the `data` key is absent when the error has none.
 * @example
 * ```ts
 * plainWire(error, error.message); // { code: -32_602, message: "[moku-editor] …", data: { … } }
 * ```
 */
function plainWire(error: WireError, message: string): WireError {
  const wire: WireError = { code: error.code, message };

  if (error.data !== undefined) wire.data = copyData(error.data);

  return wire;
}

/**
 * Builds an `Error & WireError` (a ProtocolError); adds the prefix when the message lacks it.
 *
 * @param code - JSON-RPC error code.
 * @param message - The message, with or without the prefix.
 * @param data - Optional data; set `reason` and `retryable` from the reason table.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw wireError(-32_004, "forbidden path: ../x.ts", { reason: "forbidden_path", retryable: false, id: "../x.ts" });
 * ```
 */
export function wireError(code: number, message: string, data?: WireErrorData): Error & WireError {
  return new ProtocolError(code, withPrefix(message), data);
}

/**
 * True for an object with an integer `code`, a string `message` and `data` absent or an object.
 *
 * @param value - Anything.
 * @returns Whether `value` is a WireError (a ProtocolError, a FilesError, a decoded error member).
 * @example
 * ```ts
 * if (isWireError(error)) toast(bareMessage(error.message));
 * ```
 */
export function isWireError(value: unknown): value is WireError {
  if (!isRecord(value) || !("code" in value) || !("message" in value)) return false;

  const data = "data" in value ? value.data : undefined;

  return (
    Number.isInteger(value.code) &&
    typeof value.message === "string" &&
    (data === undefined || isRecord(data))
  );
}

/**
 * Turns anything thrown into a WireError for a response; never includes a stack.
 *
 * @param error - A ProtocolError, a wire-error-like object, an Error or anything else.
 * @returns A fresh WireError whose message starts with `[moku-editor] `.
 * @example
 * ```ts
 * socket.send(encode(failure(id, toWireError(error))));
 * ```
 */
export function toWireError(error: unknown): WireError {
  if (isWireError(error)) return plainWire(error, withPrefix(error.message));

  if (error instanceof Error && "wire" in error && isWireError(error.wire)) {
    return plainWire(error.wire, withPrefix(error.wire.message));
  }

  return {
    code: errorCode.commandFailed,
    message: error instanceof Error ? withPrefix(error.message) : UNKNOWN_ERROR,
    data: { reason: "command_failed", retryable: false }
  };
}

/**
 * Rebuilds a ProtocolError from a WireError received on the wire.
 *
 * @param error - The error member of a response.
 * @returns The error, ready to reject a pending call with.
 * @example
 * ```ts
 * pending.reject(fromWireError(response.error));
 * ```
 */
export function fromWireError(error: WireError): ProtocolError {
  const data = error.data === undefined ? undefined : copyData(error.data);

  return new ProtocolError(error.code, withPrefix(error.message), data);
}

/**
 * True when the error is a WireError with `data.retryable` or code -32001 / -32002.
 *
 * @param error - Anything.
 * @returns Whether the call may be tried again.
 * @example
 * ```ts
 * if (isRetryable(error)) scheduleRetry();
 * ```
 */
export function isRetryable(error: unknown): boolean {
  return (
    isWireError(error) &&
    (error.data?.retryable === true ||
      error.code === errorCode.gameReloaded ||
      error.code === errorCode.timeout)
  );
}

/**
 * Strips the `[moku-editor] ` prefix, for text shown in the UI (R7).
 *
 * @param message - A wire error message.
 * @returns The message without the prefix.
 * @example
 * ```ts
 * bareMessage("[moku-editor] game.step: frames must be a number"); // "game.step: frames must be a number"
 * ```
 */
export function bareMessage(message: string): string {
  return message.startsWith(ERROR_PREFIX) ? message.slice(ERROR_PREFIX.length) : message;
}
