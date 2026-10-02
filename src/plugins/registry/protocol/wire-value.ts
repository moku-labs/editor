/**
 * @file Protocol — toWireValue: any value to wire-safe Json ($map, $set, $error tags; cycles,
 * functions, symbols and bigint rejected with -32006).
 */
import { errorCode, wireError } from "./errors";
import type { Json } from "./types";

/**
 * The deepest nesting of containers a wire value may have.
 */
const MAX_DEPTH = 64;

/**
 * The JSON null: what NaN, ±Infinity and undefined become.
 */
// eslint-disable-next-line unicorn/no-null -- null is the JSON value the wire carries
const JSON_NULL: Json = null;

/**
 * Where a conversion stands: the path of the value and the containers above it.
 */
type Walk = { readonly path: string; readonly ancestors: Set<object> };

/**
 * Builds the -32006 error for the value at a path.
 *
 * @param message - What is wrong, e.g. "function is not JSON".
 * @param path - Where, e.g. "$.nodes[3].next".
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw notJson("cycle", "$.a");
 * ```
 */
function notJson(message: string, path: string): Error {
  return wireError(errorCode.notJson, `${message} at ${path}`, {
    reason: "not_json",
    retryable: false,
    field: path
  });
}

/**
 * The type name of an object the wire refuses, or undefined for every other object.
 *
 * @param value - An object.
 * @returns "ArrayBuffer", "DataView", "WeakMap", "WeakSet", "Promise" or undefined.
 * @example
 * ```ts
 * refusedType(Promise.resolve(1)); // "Promise"
 * ```
 */
function refusedType(value: object): string | undefined {
  if (value instanceof ArrayBuffer) return "ArrayBuffer";
  if (value instanceof DataView) return "DataView";
  if (value instanceof WeakMap) return "WeakMap";
  if (value instanceof WeakSet) return "WeakSet";
  if (value instanceof Promise) return "Promise";

  return undefined;
}

/**
 * Converts a primitive (anything that is not an object).
 *
 * @param value - A primitive value.
 * @param path - Its path, for the error.
 * @returns The Json value.
 * @throws {Error} -32006 for a bigint, a function or a symbol.
 * @example
 * ```ts
 * primitive(-0, "$"); // 0
 * ```
 */
function primitive(value: unknown, path: string): Json {
  switch (typeof value) {
    case "boolean":
    case "string": {
      return value;
    }
    case "number": {
      // JSON.stringify semantics: NaN and ±Infinity are null; -0 is 0.
      return Number.isFinite(value) ? value + 0 : JSON_NULL;
    }
    case "undefined": {
      return JSON_NULL;
    }
    default: {
      throw notJson(`${typeof value} is not JSON`, path);
    }
  }
}

/**
 * Converts the entries of an object: own enumerable string keys, in order; undefined dropped.
 *
 * @param value - Any object.
 * @param walk - Where the conversion stands.
 * @returns The plain Json object.
 * @example
 * ```ts
 * objectValue({ a: 1, b: undefined }, walk); // { a: 1 }
 * ```
 */
function objectValue(value: object, walk: Walk): Json {
  const entries: [string, Json][] = [];

  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) entries.push([key, convert(child, `${walk.path}.${key}`, walk)]);
  }

  return Object.fromEntries(entries);
}

/**
 * Converts a container whose kind the table names: array, Map, Set, Error, typed array.
 *
 * @param value - Any object.
 * @param walk - Where the conversion stands.
 * @returns The Json value, or undefined when the object is none of those kinds.
 * @example
 * ```ts
 * knownContainer(new Set([1]), walk); // { $set: [1] }
 * ```
 */
function knownContainer(value: object, walk: Walk): Json | undefined {
  const { path } = walk;

  if (Array.isArray(value))
    return [...value].map((item, index) => convert(item, `${path}[${index}]`, walk));

  if (value instanceof Map) {
    return {
      $map: [...value].map(([key, item]: [unknown, unknown], index) => [
        convert(key, `${path}.<map>[${index}][0]`, walk),
        convert(item, `${path}.<map>[${index}][1]`, walk)
      ])
    };
  }

  if (value instanceof Set) {
    return {
      $set: [...value].map((item, index) => convert(item, `${path}.<set>[${index}]`, walk))
    };
  }

  if (value instanceof Error)
    return { $error: { name: String(value.name), message: String(value.message) } };

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    // A typed array: read it by index, so every kind (Float16Array included) is covered.
    const length = Number(Reflect.get(value, "length"));

    return Array.from({ length }, (_, index) =>
      convert(Reflect.get(value, index), `${path}[${index}]`, walk)
    );
  }

  return undefined;
}

/**
 * Converts an object: refused types throw, known containers are tagged or copied, `toJSON` is
 * called, and any other object is read by its own enumerable string keys.
 *
 * @param value - Any object.
 * @param walk - Where the conversion stands; `value` is already on the ancestor stack.
 * @returns The Json value.
 * @example
 * ```ts
 * objectOf(new Date(0), walk); // "1970-01-01T00:00:00.000Z"
 * ```
 */
function objectOf(value: object, walk: Walk): Json {
  const refused = refusedType(value);

  if (refused !== undefined) throw notJson(`${refused} is not JSON`, walk.path);

  const known = knownContainer(value, walk);

  if (known !== undefined) return known;

  const toJson: unknown = Reflect.get(value, "toJSON");

  if (typeof toJson === "function") {
    const next: unknown = Reflect.apply(toJson, value, []);

    return convert(next, walk.path, walk);
  }

  return objectValue(value, walk);
}

/**
 * Converts any value at a path, with the cycle and the depth checks.
 *
 * @param value - Any value.
 * @param path - Its path.
 * @param walk - The ancestors of the parent.
 * @returns The Json value.
 * @example
 * ```ts
 * convert(new Map([["a", 1]]), "$", { path: "$", ancestors: new Set() }); // { $map: [["a", 1]] }
 * ```
 */
function convert(value: unknown, path: string, walk: Walk): Json {
  if (value === null) return JSON_NULL;
  if (typeof value !== "object") return primitive(value, path);

  const { ancestors } = walk;

  if (ancestors.has(value)) throw notJson("cycle", path);
  if (ancestors.size >= MAX_DEPTH) throw notJson(`nesting deeper than ${MAX_DEPTH}`, path);

  ancestors.add(value);

  try {
    return objectOf(value, { path, ancestors });
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Converts a value to Json by the toWireValue table (01-registry); throws -32006 with the path.
 *
 * @param value - Any value a door returned.
 * @returns A fresh Json structure; the input is never mutated.
 * @throws {Error} A ProtocolError -32006 `not_json` whose `field` is the path, e.g. `$.a[1].b`.
 * @example
 * ```ts
 * toWireValue(new Map([["a", 1]])); // { $map: [["a", 1]] }
 * ```
 */
export function toWireValue(value: unknown): Json {
  return convert(value, "$", { path: "$", ancestors: new Set() });
}
