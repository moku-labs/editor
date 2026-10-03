/**
 * @file registry plugin — the errors of the entries: the id after the prefix, door failures
 * (-32000 command_failed) and the checked steps (checkInput, toWireValue) of every entry.
 */

import type { InputOf, InputSchema, Json } from "../protocol";
import {
  bareMessage,
  checkInput,
  ERROR_PREFIX,
  errorCode,
  ProtocolError,
  toWireError,
  toWireValue,
  wireError
} from "../protocol";

/**
 * The message of anything thrown.
 *
 * @param error - A thrown value.
 * @returns Its message, or its text.
 * @example
 * ```ts
 * messageOf(new Error("boom")); // "boom"
 * ```
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The first line of a message (game errors carry a hint on the second line).
 *
 * @param message - A message.
 * @returns Its first line.
 * @example
 * ```ts
 * firstLine("[game] Control commands run in dev builds only.\n  Define …"); // "[game] Control commands run in dev builds only."
 * ```
 */
export function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? "";
}

/**
 * Rebuilds an error with the registry id after the prefix and in `data.id`.
 *
 * @param id - The source or command id.
 * @param error - Anything thrown.
 * @returns The ProtocolError, e.g. `[moku-editor] game.step: frames must be a number`.
 * @example
 * ```ts
 * throw withId("game.step", error);
 * ```
 */
export function withId(id: string, error: unknown): ProtocolError {
  const wire = toWireError(error);

  return new ProtocolError(wire.code, `${ERROR_PREFIX}${id}: ${bareMessage(wire.message)}`, {
    ...wire.data,
    id
  });
}

/**
 * The -32000 `command_failed` error of a door (or an editor command) that threw.
 *
 * @param id - The source or command id.
 * @param message - What the door said.
 * @returns The ProtocolError.
 * @example
 * ```ts
 * throw doorFailed("game.log", error.message);
 * ```
 */
export function doorFailed(id: string, message: string): ProtocolError {
  return withId(
    id,
    wireError(errorCode.commandFailed, message, { reason: "command_failed", retryable: false })
  );
}

/**
 * checkInput with the id in the error.
 *
 * @param id - The entry id.
 * @param schema - The descriptor's input schema.
 * @param raw - The raw input.
 * @returns The checked input.
 * @throws {Error} -32602 `[moku-editor] <id>: <field> …`.
 * @example
 * ```ts
 * const input = checkedInput("game.step", door.input, raw);
 * ```
 */
export function checkedInput<S extends InputSchema>(id: string, schema: S, raw: Json): InputOf<S> {
  try {
    return checkInput(schema, raw);
  } catch (error) {
    throw withId(id, error);
  }
}

/**
 * toWireValue with the id in the error.
 *
 * @param id - The entry id.
 * @param value - What the door answered.
 * @returns The wire value.
 * @throws {Error} -32006 `[moku-editor] <id>: <what> is not JSON at <path>`.
 * @example
 * ```ts
 * return wireValueOf("game.graph", graph);
 * ```
 */
export function wireValueOf(id: string, value: unknown): Json {
  try {
    return toWireValue(value);
  } catch (error) {
    throw withId(id, error);
  }
}
