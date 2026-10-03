/**
 * @file Protocol — checkInput and isJson. checkInput holds the one boundary cast of the editor
 * (`as InputOf<S>` on the validated object).
 */
import { errorCode, wireError } from "./errors";
import type { InputKind, InputOf, InputSchema, Json } from "./types";

/**
 * The base kind of every declared kind: `"number?"` → `"number"`.
 */
const BASE_KIND: Readonly<Record<InputKind | `${InputKind}?`, InputKind>> = {
  string: "string",
  "string?": "string",
  number: "number",
  "number?": "number",
  boolean: "boolean",
  "boolean?": "boolean",
  json: "json",
  "json?": "json"
};

/**
 * Builds the -32602 error of a field (or of the whole input when no field is given).
 *
 * @param message - One short line, without the prefix.
 * @param field - The field the error names, if any.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw invalid("frames must be a number", "frames");
 * ```
 */
function invalid(message: string, field?: string): Error {
  const data = field === undefined ? {} : { field };

  return wireError(errorCode.invalidInput, message, {
    reason: "invalid_input",
    retryable: false,
    ...data
  });
}

/**
 * True for an object that is not an array, with Object.prototype or no prototype at all.
 *
 * @param value - Anything.
 * @returns Whether `value` is a plain object.
 * @example
 * ```ts
 * isPlainObject(new Date()); // false
 * ```
 */
function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Deep JSON check with an ancestor stack: a shared reference is fine, a cycle is not.
 *
 * @param value - Anything.
 * @param ancestors - The containers above `value`.
 * @returns Whether `value` is JSON.
 * @example
 * ```ts
 * isJsonWithin([1, "a"], new Set()); // true
 * ```
 */
function isJsonWithin(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? [...value].every(item => isJsonWithin(item, ancestors))
    : isPlainObject(value) && Object.values(value).every(item => isJsonWithin(item, ancestors));
  ancestors.delete(value);

  return valid;
}

/**
 * Deep check that a value is JSON (finite numbers, plain objects, no cycles).
 *
 * @param value - Anything.
 * @returns Whether `value` is a Json value.
 * @example
 * ```ts
 * isJson({ a: [1, "x", null] }); // true
 * ```
 */
export function isJson(value: unknown): value is Json {
  return isJsonWithin(value, new Set());
}

/**
 * The error message of a value that does not fit its kind, or undefined when it fits.
 *
 * @param field - The field name.
 * @param kind - The base kind (no `?`).
 * @param value - The present value.
 * @returns The message, or undefined.
 * @example
 * ```ts
 * kindProblem("frames", "number", "1"); // "frames must be a number"
 * ```
 */
function kindProblem(field: string, kind: InputKind, value: Json): string | undefined {
  switch (kind) {
    case "json": {
      return isJson(value) ? undefined : `${field} must be JSON`;
    }
    case "number": {
      if (typeof value !== "number") return `${field} must be a number`;
      return Number.isFinite(value) ? undefined : `${field} must be a finite number`;
    }
    default: {
      return typeof value === kind ? undefined : `${field} must be a ${kind}`;
    }
  }
}

/**
 * Checks raw input against a schema; throws -32602 naming the field; unknown fields are rejected.
 *
 * @param schema - The descriptor's input schema.
 * @param raw - The raw input from the wire (`null` = no input).
 * @returns A new plain object with exactly the present schema keys.
 * @throws {Error} A ProtocolError -32602 `invalid_input` naming the field.
 * @example
 * ```ts
 * const { frames } = checkInput({ frames: "number", deltaMs: "number?" }, { frames: 1 });
 * ```
 */
export function checkInput<S extends InputSchema>(schema: S, raw: Json): InputOf<S> {
  const given = raw ?? {};

  if (typeof given !== "object" || Array.isArray(given)) throw invalid("input must be an object");

  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(schema, key)) throw invalid(`${key} is not a known input`, key);
  }

  const entries: [string, Json][] = [];

  for (const [field, declared] of Object.entries(schema)) {
    const kind = BASE_KIND[declared];
    const optional = kind !== declared;
    const value = Object.hasOwn(given, field) ? given[field] : undefined;

    if (value === undefined) {
      if (optional) continue;
      throw invalid(`${field} is required`, field);
    }

    const problem = kindProblem(field, kind, value);

    if (problem !== undefined) throw invalid(problem, field);
    entries.push([field, value]);
  }

  // boundary: the object was checked field by field against S
  return Object.fromEntries(entries) as InputOf<S>;
}
