/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { describe, expect, it } from "vitest";
import { ProtocolError, toWireValue } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// toWireValue — one case per row of the 01-registry table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs toWireValue and returns the thrown ProtocolError.
 *
 * @param value - Any value.
 * @returns The error.
 */
function failureOf(value: unknown): ProtocolError {
  try {
    toWireValue(value);
  } catch (error) {
    if (error instanceof ProtocolError) return error;
    throw error;
  }
  throw new Error("toWireValue did not throw");
}

/**
 * Builds `levels` nested arrays: nest(1) is [], nest(2) is [[]].
 *
 * @param levels - Nesting levels.
 * @returns The nested arrays.
 */
function nest(levels: number): unknown[] {
  let value: unknown[] = [];
  for (let level = 1; level < levels; level += 1) value = [value];
  return value;
}

describe("toWireValue", () => {
  it("keeps null, booleans and strings", () => {
    expect(toWireValue(null)).toBeNull();
    expect(toWireValue(true)).toBe(true);
    expect(toWireValue(false)).toBe(false);
    expect(toWireValue("board/awaitIntent")).toBe("board/awaitIntent");
  });

  it("keeps finite numbers and turns -0 into 0", () => {
    expect(toWireValue(1840)).toBe(1840);
    expect(toWireValue(16.5)).toBe(16.5);
    expect(Object.is(toWireValue(-0), 0)).toBe(true);
    expect(toWireValue({ a: -0 })).toEqual({ a: 0 });
    expect(Object.is((toWireValue([-0]) as number[])[0], 0)).toBe(true);
  });

  it("turns NaN and ±Infinity into null", () => {
    expect(toWireValue(Number.NaN)).toBeNull();
    expect(toWireValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toWireValue({ a: Number.NEGATIVE_INFINITY })).toEqual({ a: null });
  });

  it("turns a top-level undefined into null", () => {
    expect(toWireValue(undefined)).toBeNull();
  });

  it("drops an undefined object property", () => {
    const value = toWireValue({ a: 1, b: undefined, c: "x" });

    expect(value).toEqual({ a: 1, c: "x" });
    expect(Object.keys(value as object)).toEqual(["a", "c"]);
  });

  it("turns undefined and holes in an array into null", () => {
    // biome-ignore lint/suspicious/noSparseArray: the row under test is a hole
    expect(toWireValue([1, undefined, , 4])).toEqual([1, null, null, 4]);
  });

  it("throws for a bigint", () => {
    const error = failureOf({ a: [1n] });

    expect(error.code).toBe(-32_006);
    expect(error.message).toBe("[moku-editor] bigint is not JSON at $.a[0]");
    expect(error.data).toEqual({ reason: "not_json", retryable: false, field: "$.a[0]" });
  });

  it("throws for a function, top level or as an object property", () => {
    expect(failureOf(() => 1).message).toBe("[moku-editor] function is not JSON at $");
    expect(failureOf({ a: [{ b: () => 1 }] }).message).toBe(
      "[moku-editor] function is not JSON at $.a[0].b"
    );
  });

  it("throws for a symbol, top level or as an object property", () => {
    expect(failureOf(Symbol("s")).message).toBe("[moku-editor] symbol is not JSON at $");
    expect(failureOf({ s: Symbol("s") }).data?.field).toBe("$.s");
  });

  it("tags a Map as $map with [key, value] pairs, keys and values converted", () => {
    const key = { x: 1 };
    const map = new Map<unknown, unknown>([
      ["a", 1],
      [key, new Set([2])]
    ]);

    expect(toWireValue(map)).toEqual({
      $map: [
        ["a", 1],
        [{ x: 1 }, { $set: [2] }]
      ]
    });
  });

  it("names the entry of a Map in the path", () => {
    const map = new Map([["a", { f: () => 1 }]]);

    expect(failureOf({ store: map }).data?.field).toBe("$.store.<map>[0][1].f");
  });

  it("tags a Set as $set", () => {
    expect(toWireValue(new Set(["a", "b"]))).toEqual({ $set: ["a", "b"] });
    expect(failureOf(new Set([1n])).data?.field).toBe("$.<set>[0]");
  });

  it("tags an Error as $error with name and message, without the stack", () => {
    const value = toWireValue({ entry: new TypeError("x is undefined") });

    expect(value).toEqual({ entry: { $error: { name: "TypeError", message: "x is undefined" } } });
    expect(JSON.stringify(value)).not.toContain("stack");
  });

  it("uses a callable toJSON (Date)", () => {
    expect(toWireValue({ at: new Date(0) })).toEqual({ at: "1970-01-01T00:00:00.000Z" });
  });

  it("converts the toJSON result again", () => {
    const value = { toJSON: () => ({ when: new Date(0), skip: undefined }) };

    expect(toWireValue(value)).toEqual({ when: "1970-01-01T00:00:00.000Z" });
  });

  it("detects a toJSON that returns its own object as a cycle", () => {
    const value: { toJSON?: () => unknown } = {};
    value.toJSON = () => value;

    expect(failureOf(value).message).toBe("[moku-editor] cycle at $");
  });

  it("turns a typed array into a plain number array", () => {
    const value = toWireValue(new Float32Array([1.5, 2]));

    expect(value).toEqual([1.5, 2]);
    expect(Array.isArray(value)).toBe(true);
    expect(toWireValue(new Uint8Array([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it.each([
    ["ArrayBuffer", new ArrayBuffer(2)],
    ["DataView", new DataView(new ArrayBuffer(2))],
    ["WeakMap", new WeakMap()],
    ["WeakSet", new WeakSet()],
    ["Promise", Promise.resolve(1)]
  ])("throws for a %s", (name, value) => {
    expect(failureOf({ v: value }).message).toBe(`[moku-editor] ${name} is not JSON at $.v`);
  });

  it("converts an array element-wise", () => {
    expect(toWireValue([1, "a", [true, null], { b: 2 }])).toEqual([1, "a", [true, null], { b: 2 }]);
  });

  it("keeps own enumerable string keys in order and ignores symbol keys", () => {
    const value = { b: 1, a: 2, [Symbol("hidden")]: 3 };
    Object.defineProperty(value, "secret", { value: 4, enumerable: false });
    const wire = toWireValue(value);

    expect(Object.keys(wire as object)).toEqual(["b", "a"]);
    expect(wire).toEqual({ b: 1, a: 2 });
  });

  it("reads a class instance by its own enumerable keys", () => {
    class Point {
      x = 1;
      y = 2;
      /**
       * A method on the prototype.
       *
       * @returns The sum.
       */
      sum(): number {
        return this.x + this.y;
      }
    }

    expect(toWireValue(new Point())).toEqual({ x: 1, y: 2 });
  });

  it("keeps a __proto__ key as an own data key", () => {
    const value: unknown = JSON.parse('{"__proto__":{"polluted":true}}');
    const wire = toWireValue(value);

    expect(Object.hasOwn(wire as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(wire)).toBe(Object.prototype);
  });

  it("throws 'cycle' for a value that is its own ancestor", () => {
    const node: { name: string; next?: unknown } = { name: "a" };
    node.next = { name: "b", next: node };
    const nodes = [0, 1, 2, node];

    const error = failureOf({ nodes });

    expect(error.message).toBe("[moku-editor] cycle at $.nodes[3].next.next");
    expect(error.data).toEqual({
      reason: "not_json",
      retryable: false,
      field: "$.nodes[3].next.next"
    });
  });

  it("copies a shared non-cyclic reference twice", () => {
    const shared = { n: 1 };
    const wire = toWireValue({ a: shared, b: [shared] }) as { a: object; b: object[] };

    expect(wire).toEqual({ a: { n: 1 }, b: [{ n: 1 }] });
    expect(wire.a).not.toBe(wire.b[0]);
  });

  it("accepts 64 levels of nesting", () => {
    expect(() => toWireValue(nest(64))).not.toThrow();
  });

  it("throws past 64 levels of nesting", () => {
    const error = failureOf(nest(65));

    expect(error.code).toBe(-32_006);
    expect(error.message).toMatch(/^\[moku-editor] nesting deeper than 64 at \$(\[0])+$/);
  });

  it("builds a fresh structure and never mutates the input", () => {
    const inner = { b: [1, 2] };
    const input = { a: inner, u: undefined };
    const wire = toWireValue(input) as { a: { b: number[] } };

    expect(wire.a).not.toBe(inner);
    expect(wire.a.b).not.toBe(inner.b);
    expect(input).toEqual({ a: { b: [1, 2] }, u: undefined });
    expect(Object.hasOwn(input, "u")).toBe(true);
  });
});
