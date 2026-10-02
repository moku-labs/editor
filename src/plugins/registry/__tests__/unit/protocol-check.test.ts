/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { describe, expect, it } from "vitest";
import type { InputSchema, Json } from "../../protocol";
import { checkInput, isJson, ProtocolError } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// checkInput — one `it` per row of the 01-registry table
// ─────────────────────────────────────────────────────────────────────────────

/** The door schemas the spec names. */
const step = { frames: "number", deltaMs: "number?" } as const;
const walk = { route: "json" } as const;
const answer = { intent: "string", payload: "json?" } as const;
const restore = { bookmark: "json?", repro: "json?" } as const;
const flags = { on: "boolean", label: "string?" } as const;

/**
 * Runs checkInput and returns the thrown ProtocolError.
 *
 * @param schema - Schema.
 * @param raw - Raw input.
 * @returns The error.
 */
function failureOf(schema: InputSchema, raw: Json): ProtocolError {
  try {
    checkInput(schema, raw);
  } catch (error) {
    if (error instanceof ProtocolError) return error;
    throw error;
  }
  throw new Error("checkInput did not throw");
}

describe("checkInput", () => {
  it("row 1: treats null as no input ({})", () => {
    expect(checkInput(restore, null)).toEqual({});
    expect(checkInput({}, null)).toEqual({});
  });

  it("row 1: null fails a schema with a required field as a missing field", () => {
    expect(failureOf(step, null).message).toBe("[moku-editor] frames is required");
  });

  it.each([
    ["an array", [1]],
    ["a string", "x"],
    ["a number", 1],
    ["a boolean", true]
  ])("row 2: rejects %s with 'input must be an object' and no field", (_label, raw) => {
    const error = failureOf(step, raw);

    expect(error.code).toBe(-32_602);
    expect(error.message).toBe("[moku-editor] input must be an object");
    expect(error.data).toEqual({ reason: "invalid_input", retryable: false });
  });

  it("row 3: rejects an own key not in the schema, naming it", () => {
    const error = failureOf(step, { frames: 1, speed: 2 });

    expect(error.code).toBe(-32_602);
    expect(error.message).toBe("[moku-editor] speed is not a known input");
    expect(error.data).toEqual({ reason: "invalid_input", retryable: false, field: "speed" });
  });

  it("row 3: checks unknown keys first, in key order", () => {
    expect(failureOf(step, { zeta: 1, frames: "x", alpha: 2 }).data?.field).toBe("zeta");
  });

  it("row 4: rejects a missing required field", () => {
    const error = failureOf(answer, { payload: { a: 1 } });

    expect(error.message).toBe("[moku-editor] intent is required");
    expect(error.data).toEqual({ reason: "invalid_input", retryable: false, field: "intent" });
  });

  it("row 5: accepts a missing optional field and leaves the key out", () => {
    const input = checkInput(step, { frames: 2 });

    expect(input).toEqual({ frames: 2 });
    expect(Object.keys(input)).toEqual(["frames"]);
  });

  it("row 6: rejects a string kind given a number", () => {
    const error = failureOf(answer, { intent: 3 });

    expect(error.message).toBe("[moku-editor] intent must be a string");
    expect(error.data?.field).toBe("intent");
  });

  it("row 7: rejects a number kind given a string", () => {
    const error = failureOf(step, { frames: "1" });

    expect(error.message).toBe("[moku-editor] frames must be a number");
    expect(error.data).toEqual({ reason: "invalid_input", retryable: false, field: "frames" });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ])("row 7: rejects the non-finite number %s", value => {
    expect(failureOf(step, { frames: value }).message).toBe(
      "[moku-editor] frames must be a finite number"
    );
  });

  it("row 7: rejects an optional number kind given a string", () => {
    expect(failureOf(step, { frames: 1, deltaMs: "16" }).message).toBe(
      "[moku-editor] deltaMs must be a number"
    );
  });

  it("row 8: rejects a boolean kind given a string", () => {
    const error = failureOf(flags, { on: "true" });

    expect(error.message).toBe("[moku-editor] on must be a boolean");
    expect(error.data?.field).toBe("on");
  });

  it("row 9: passes a json value through as is (no copy)", () => {
    const route = [{ at: "home", intent: "play" }];
    const raw = { route };

    expect(checkInput(walk, raw).route).toBe(route);
  });

  it("row 9: passes every JSON kind for json", () => {
    for (const value of [null, true, 0, "s", [1, [2]], { a: { b: [null] } }]) {
      expect(checkInput(walk, { route: value }).route).toBe(value);
    }
  });

  it("row 9: rejects a json kind that is not JSON", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    // boundary of the test: a value no JSON input can hold
    const raw = { route: cyclic } as unknown as Json;

    const error = failureOf(walk, raw);

    expect(error.message).toBe("[moku-editor] route must be JSON");
    expect(error.data).toEqual({ reason: "invalid_input", retryable: false, field: "route" });
  });

  it("row 10: rejects null for a required non-json kind", () => {
    expect(failureOf(step, { frames: null }).message).toBe("[moku-editor] frames must be a number");
  });

  it("row 10: rejects null for an optional non-json kind", () => {
    expect(failureOf(flags, { on: true, label: null }).message).toBe(
      "[moku-editor] label must be a string"
    );
  });

  it("row 11: passes null for json?", () => {
    const input = checkInput(restore, { bookmark: null });

    expect(input).toEqual({ bookmark: null });
    expect(Object.hasOwn(input, "bookmark")).toBe(true);
  });

  it("row 12: reads own keys only; __proto__ and constructor are unknown inputs", () => {
    const proto: Json = JSON.parse('{"frames":1,"__proto__":{"polluted":true}}');
    const ctor: Json = JSON.parse('{"frames":1,"constructor":{"x":1}}');

    expect(failureOf(step, proto).data?.field).toBe("__proto__");
    expect(failureOf(step, ctor).data?.field).toBe("constructor");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("row 12: ignores inherited keys and builds a plain result", () => {
    const raw = Object.create({ inherited: 1 }) as { frames?: number };
    raw.frames = 3;
    // boundary of the test: an object with a prototype chain
    const input = checkInput(step, raw as unknown as Json);

    expect(input).toEqual({ frames: 3 });
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
  });

  it("result: has exactly the present schema keys, in schema order", () => {
    const input = checkInput(answer, { payload: { n: 1 }, intent: "play" });

    expect(Object.keys(input)).toEqual(["intent", "payload"]);
    expect(input).toEqual({ intent: "play", payload: { n: 1 } });
  });

  it("result: does not mutate the raw input and returns a new object", () => {
    const raw = { frames: 1, deltaMs: 16 };
    const frozen = Object.freeze({ ...raw });
    const input = checkInput(step, frozen);

    expect(input).not.toBe(frozen);
    expect(frozen).toEqual(raw);
  });

  it("result: is typed by the schema", () => {
    const input = checkInput(step, { frames: 1, deltaMs: 8 });
    const frames: number = input.frames;
    const deltaMs: number | undefined = input.deltaMs;

    expect(frames + (deltaMs ?? 0)).toBe(9);
  });

  it("accepts the game.restore schema with neither field", () => {
    expect(checkInput(restore, {})).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isJson
// ─────────────────────────────────────────────────────────────────────────────

describe("isJson", () => {
  it.each([
    ["null", null],
    ["true", true],
    ["a finite number", 1.5],
    ["a string", ""],
    ["an empty array", []],
    ["a nested structure", { a: [1, { b: null }], c: "x" }],
    ["a null-prototype object", Object.assign(Object.create(null) as object, { a: 1 })],
    [
      "a shared non-cyclic reference",
      (() => {
        const shared = { n: 1 };
        return { a: shared, b: shared };
      })()
    ]
  ])("is true for %s", (_label, value) => {
    expect(isJson(value)).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a bigint", 1n],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["an array with undefined", [undefined]],
    // biome-ignore lint/suspicious/noSparseArray: the case under test is a hole
    ["an array with a hole", [1, , 3]],
    ["an object with an undefined value", { a: undefined }],
    ["a nested function", { a: [{ b: () => 1 }] }],
    [
      "a class instance",
      new (class Point {
        x = 1;
      })()
    ]
  ])("is false for %s", (_label, value) => {
    expect(isJson(value)).toBe(false);
  });

  it("is false for a cycle", () => {
    const list: unknown[] = [];
    list.push(list);
    const object: { self?: unknown } = {};
    object.self = { inner: object };

    expect(isJson(list)).toBe(false);
    expect(isJson(object)).toBe(false);
  });
});
