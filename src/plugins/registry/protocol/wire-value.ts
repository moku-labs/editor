/**
 * @file Protocol — toWireValue: any value to wire-safe Json ($map, $set, $error tags; cycles,
 * functions, symbols and bigint rejected with -32006). The conversion allocates the result and
 * nothing else on the way (F56): the path of a refused value is put together only when one is
 * refused, as the refusal travels up through the containers. A value toWireValue built is known
 * and passed on as it is, so a value converted by its owner and again by the registry's guard is
 * copied once.
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
 * The arguments of a `toJSON` call: none, shared by every call.
 */
const NO_ARGUMENTS: readonly unknown[] = Object.freeze([]);

/**
 * The key an assignment would take as the prototype; it is defined as an own data key instead.
 */
const PROTO_KEY = "__proto__";

/**
 * The containers toWireValue built and handed out: converting one again answers it unchanged.
 */
const built = new WeakSet<object>();

/**
 * True for a container toWireValue built: its content is Json already.
 *
 * @param value - An object.
 * @returns Whether toWireValue handed it out.
 * @example
 * ```ts
 * isBuilt([1]); // false: built by hand, not by toWireValue
 * ```
 */
function isBuilt(value: object): value is Json[] | { [key: string]: Json } {
  return built.has(value);
}

/**
 * A refused value on its way up: what is wrong, and the path from the container that caught it
 * last down to the value. Each container prepends its own step; `toWireValue` adds the `$`.
 */
class Refusal extends Error {
  /** The path below the container that caught the refusal last, e.g. `.nodes[3].next`. */
  below = "";
}

/**
 * Prepends a container's step to the path of a refusal; any other error passes unchanged.
 *
 * @param error - What a conversion below threw.
 * @param step - The step to the child, e.g. ".next" or "[3]".
 * @returns The same error, to rethrow.
 * @example
 * ```ts
 * throw within(error, `[${index}]`);
 * ```
 */
function within(error: unknown, step: string): unknown {
  if (error instanceof Refusal) error.below = `${step}${error.below}`;
  return error;
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
 * @returns The Json value.
 * @throws {Refusal} For a bigint, a function or a symbol.
 * @example
 * ```ts
 * primitive(-0); // 0
 * ```
 */
function primitive(value: unknown): Json {
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
      throw new Refusal(`${typeof value} is not JSON`);
    }
  }
}

/**
 * Converts the entries of an object: own enumerable string keys, in order; undefined dropped.
 * `for…in` with an own-key test walks the same keys as `Object.entries` without building them.
 *
 * @param value - Any object.
 * @param ancestors - The containers above it, itself included.
 * @returns The plain Json object.
 * @example
 * ```ts
 * objectValue({ a: 1, b: undefined }, ancestors); // { a: 1 }
 * ```
 */
function objectValue(value: object, ancestors: Set<object>): Json {
  const result: { [key: string]: Json } = {};

  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    const child: unknown = Reflect.get(value, key);
    if (child === undefined) continue;

    let converted: Json;
    try {
      converted = convert(child, ancestors);
    } catch (error) {
      throw within(error, `.${key}`);
    }
    if (key === PROTO_KEY) {
      Object.defineProperty(result, key, {
        value: converted,
        enumerable: true,
        writable: true,
        configurable: true
      });
    } else {
      result[key] = converted;
    }
  }

  return result;
}

/**
 * Converts the items of an array, or of a typed array read by index (so every kind, Float16Array
 * included, is covered). Holes and undefined become null.
 *
 * @param value - An array or a typed array.
 * @param length - Its length.
 * @param ancestors - The containers above it, itself included.
 * @returns The Json array.
 * @example
 * ```ts
 * itemsOf([1, undefined], 2, ancestors); // [1, null]
 * ```
 */
function itemsOf(value: object, length: number, ancestors: Set<object>): Json[] {
  const items: Json[] = [];

  for (let index = 0; index < length; index += 1) {
    try {
      items.push(convert(Reflect.get(value, index), ancestors));
    } catch (error) {
      throw within(error, `[${index}]`);
    }
  }

  return items;
}

/**
 * Converts a Map to its `[key, value]` pairs, keys and values converted, in order.
 *
 * @param value - The Map.
 * @param ancestors - The containers above it, itself included.
 * @returns The pairs of `$map`.
 * @example
 * ```ts
 * pairsOf(new Map([["a", 1]]), ancestors); // [["a", 1]]
 * ```
 */
function pairsOf(value: ReadonlyMap<unknown, unknown>, ancestors: Set<object>): Json[] {
  const pairs: Json[] = [];

  // Keys, then a lookup: entries() would build a [key, value] array per entry on the way.
  for (const key of value.keys()) {
    const index = pairs.length;
    let wireKey: Json;
    try {
      wireKey = convert(key, ancestors);
    } catch (error) {
      throw within(error, `.<map>[${index}][0]`);
    }
    try {
      pairs.push([wireKey, convert(value.get(key), ancestors)]);
    } catch (error) {
      throw within(error, `.<map>[${index}][1]`);
    }
  }

  return pairs;
}

/**
 * Converts the members of a Set, in order.
 *
 * @param value - The Set.
 * @param ancestors - The containers above it, itself included.
 * @returns The members of `$set`.
 * @example
 * ```ts
 * membersOf(new Set([1]), ancestors); // [1]
 * ```
 */
function membersOf(value: ReadonlySet<unknown>, ancestors: Set<object>): Json[] {
  const members: Json[] = [];

  for (const item of value) {
    try {
      members.push(convert(item, ancestors));
    } catch (error) {
      throw within(error, `.<set>[${members.length}]`);
    }
  }

  return members;
}

/**
 * Converts a container whose kind the table names: array, Map, Set, Error, typed array.
 *
 * @param value - Any object.
 * @param ancestors - The containers above it, itself included.
 * @returns The Json value, or undefined when the object is none of those kinds.
 * @example
 * ```ts
 * knownContainer(new Set([1]), ancestors); // { $set: [1] }
 * ```
 */
function knownContainer(value: object, ancestors: Set<object>): Json | undefined {
  if (Array.isArray(value)) return itemsOf(value, value.length, ancestors);
  if (value instanceof Map) return { $map: pairsOf(value, ancestors) };
  if (value instanceof Set) return { $set: membersOf(value, ancestors) };

  if (value instanceof Error)
    return { $error: { name: String(value.name), message: String(value.message) } };

  if (ArrayBuffer.isView(value) && !(value instanceof DataView))
    return itemsOf(value, Number(Reflect.get(value, "length")), ancestors);

  return undefined;
}

/**
 * Converts an object: refused types throw, known containers are tagged or copied, `toJSON` is
 * called, and any other object is read by its own enumerable string keys.
 *
 * @param value - Any object.
 * @param ancestors - The containers above it, itself included.
 * @returns The Json value.
 * @example
 * ```ts
 * objectOf(new Date(0), ancestors); // "1970-01-01T00:00:00.000Z"
 * ```
 */
function objectOf(value: object, ancestors: Set<object>): Json {
  const refused = refusedType(value);

  if (refused !== undefined) throw new Refusal(`${refused} is not JSON`);

  const known = knownContainer(value, ancestors);

  if (known !== undefined) return known;

  const toJson: unknown = Reflect.get(value, "toJSON");

  if (typeof toJson === "function") {
    const next: unknown = Reflect.apply(toJson, value, NO_ARGUMENTS);

    return convert(next, ancestors);
  }

  return objectValue(value, ancestors);
}

/**
 * Converts any value, with the cycle and the depth checks.
 *
 * @param value - Any value.
 * @param ancestors - The containers above it.
 * @returns The Json value.
 * @throws {Refusal} For a value the wire refuses; its path is the containers' to add.
 * @example
 * ```ts
 * convert(new Map([["a", 1]]), new Set()); // { $map: [["a", 1]] }
 * ```
 */
function convert(value: unknown, ancestors: Set<object>): Json {
  if (value === null) return JSON_NULL;
  if (typeof value !== "object") return primitive(value);
  if (isBuilt(value)) return value;

  if (ancestors.has(value)) throw new Refusal("cycle");
  if (ancestors.size >= MAX_DEPTH) throw new Refusal(`nesting deeper than ${MAX_DEPTH}`);

  ancestors.add(value);

  try {
    return objectOf(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Converts a value to Json by the toWireValue table (01-registry); throws -32006 with the path.
 *
 * @param value - Any value a door returned.
 * @returns A fresh Json structure, or the value itself when toWireValue built it; the input is
 *   never mutated.
 * @throws {Error} A ProtocolError -32006 `not_json` whose `field` is the path, e.g. `$.a[1].b`.
 * @example
 * ```ts
 * toWireValue(new Map([["a", 1]])); // { $map: [["a", 1]] }
 * ```
 */
export function toWireValue(value: unknown): Json {
  try {
    const wire = convert(value, new Set());
    if (typeof wire === "object" && wire !== null) built.add(wire);
    return wire;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    const path = `$${error.below}`;
    throw wireError(errorCode.notJson, `${error.message} at ${path}`, {
      reason: "not_json",
      retryable: false,
      field: path
    });
  }
}
