/**
 * @file registry plugin — the errors of the entries: the id after the prefix, door failures
 * (-32000 command_failed), the build's refusals (-32009 read_only and dev_only) and the checked steps
 * (checkInput, toWireValue) of every entry.
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
 */
export function doorFailed(id: string, message: string): ProtocolError {
  return withId(
    id,
    wireError(errorCode.commandFailed, message, { reason: "command_failed", retryable: false })
  );
}

/**
 * The -32009 `read_only` error of a command the page's build refuses: the engine's controlReadOnly.
 *
 * @param id - The command id.
 * @returns The ProtocolError, not retryable.
 * @example
 * ```ts
 * readOnlyRefusal("game.tap").code; // -32009
 * ```
 */
export function readOnlyRefusal(id: string): ProtocolError {
  return new ProtocolError(
    errorCode.readOnly,
    `${ERROR_PREFIX}${id}: refused by this debug build, which runs read and cosmetic commands only.\n  Build the game with --debug=full to run it.`,
    { reason: "read_only", retryable: false, id }
  );
}

/**
 * The -32009 `dev_only` error of a command a page without the dev or debug flag refuses: the
 * engine's controlRefused.
 *
 * @param id - The command id.
 * @returns The ProtocolError, not retryable.
 * @example
 * ```ts
 * devOnlyRefusal("game.pause").data?.reason; // "dev_only"
 * ```
 */
export function devOnlyRefusal(id: string): ProtocolError {
  return new ProtocolError(
    errorCode.devOnly,
    `${ERROR_PREFIX}${id}: refused by this build, which has neither the dev nor the debug flag.\n  Run the game from the dev server, or build it with --debug.`,
    { reason: "dev_only", retryable: false, id }
  );
}

/**
 * True for the -32602 error of an input check: the call was refused before anything ran.
 *
 * @param error - Anything thrown.
 * @returns Whether it is an input error.
 * @example
 * ```ts
 * isInputError(wireError(-32_602, "frames must be a number", { reason: "invalid_input" })); // true
 * ```
 */
export function isInputError(error: unknown): boolean {
  return error instanceof ProtocolError && error.code === errorCode.invalidInput;
}

/**
 * checkInput with the id in the error.
 *
 * @param id - The entry id.
 * @param schema - The descriptor's input schema.
 * @param raw - The raw input.
 * @returns The checked input.
 * @throws {Error} -32602 `[moku-editor] <id>: <field> …`.
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
 */
export function wireValueOf(id: string, value: unknown): Json {
  try {
    return toWireValue(value);
  } catch (error) {
    throw withId(id, error);
  }
}
