/**
 * @file Protocol — checkInput and isJson. checkInput holds the one boundary cast of the editor
 * (`as InputOf<S>` on the validated object), added by the registry builder.
 */
import type { InputOf, InputSchema, Json } from "./types";

/**
 * Checks raw input against a schema; throws -32602 naming the field; unknown fields are rejected.
 *
 * @param _schema - The descriptor's input schema.
 * @param _raw - The raw input from the wire (`null` = no input).
 * @example
 * ```ts
 * const { frames } = checkInput({ frames: "number", deltaMs: "number?" }, { frames: 1 });
 * ```
 */
export function checkInput<S extends InputSchema>(_schema: S, _raw: Json): InputOf<S> {
  throw new Error("not implemented");
}

/**
 * Deep check that a value is JSON (finite numbers, plain objects, no cycles).
 *
 * @param _value - Anything.
 * @example
 * ```ts
 * isJson({ a: [1, "x", null] }); // true
 * ```
 */
export function isJson(_value: unknown): _value is Json {
  throw new Error("not implemented");
}
