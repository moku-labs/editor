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
   * The plain WireError of this error (`data` omitted when undefined).
   */
  get wire(): WireError {
    throw new Error("not implemented");
  }
}

/**
 * Builds an `Error & WireError` (a ProtocolError); adds the prefix when the message lacks it.
 *
 * @param _code - JSON-RPC error code.
 * @param _message - The message, with or without the prefix.
 * @param _data - Optional data; set `reason` and `retryable` from the reason table.
 * @example
 * ```ts
 * throw wireError(-32_004, "forbidden path: ../x.ts", { reason: "forbidden_path", retryable: false, id: "../x.ts" });
 * ```
 */
export function wireError(
  _code: number,
  _message: string,
  _data?: WireErrorData
): Error & WireError {
  throw new Error("not implemented");
}

/**
 * True for an object with an integer `code`, a string `message` and `data` absent or an object.
 *
 * @param _value - Anything.
 * @example
 * ```ts
 * if (isWireError(error)) toast(bareMessage(error.message));
 * ```
 */
export function isWireError(_value: unknown): _value is WireError {
  throw new Error("not implemented");
}

/**
 * Turns anything thrown into a WireError for a response; never includes a stack.
 *
 * @param _error - A ProtocolError, a wire-error-like object, an Error or anything else.
 * @example
 * ```ts
 * socket.send(encode(failure(id, toWireError(error))));
 * ```
 */
export function toWireError(_error: unknown): WireError {
  throw new Error("not implemented");
}

/**
 * Rebuilds a ProtocolError from a WireError received on the wire.
 *
 * @param _error - The error member of a response.
 * @example
 * ```ts
 * pending.reject(fromWireError(response.error));
 * ```
 */
export function fromWireError(_error: WireError): ProtocolError {
  throw new Error("not implemented");
}

/**
 * True when the error is a WireError with `data.retryable` or code -32001 / -32002.
 *
 * @param _error - Anything.
 * @example
 * ```ts
 * if (isRetryable(error)) scheduleRetry();
 * ```
 */
export function isRetryable(_error: unknown): boolean {
  throw new Error("not implemented");
}

/**
 * Strips the `[moku-editor] ` prefix, for text shown in the UI (R7).
 *
 * @param _message - A wire error message.
 * @example
 * ```ts
 * bareMessage("[moku-editor] game.step: frames must be a number"); // "game.step: frames must be a number"
 * ```
 */
export function bareMessage(_message: string): string {
  throw new Error("not implemented");
}
