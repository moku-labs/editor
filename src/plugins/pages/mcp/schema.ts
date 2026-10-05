/**
 * @file pages/mcp — checks the arguments of a tool call against its input schema (the JSON Schema
 * subset of `PropertySchema`: string with an optional enum, integer with a range, plain number,
 * boolean, a closed object of numbers such as a rect, any JSON) and reads the checked values. A
 * problem is a message for an `isError` result, so the model can fix the call.
 */
import type { Json, SelectionRect } from "../../registry/protocol";
import { isObject } from "./rpc";
import type {
  JsonObject,
  NumberFieldSchema,
  PropertySchema,
  ToolAnnotations,
  ToolInputSchema
} from "./types";

/**
 * An object property schema: a closed object of number fields.
 */
type ObjectSchema = Extract<PropertySchema, { readonly type: "object" }>;

/**
 * Why a present string does not fit its property, or undefined when it fits.
 *
 * @param name - The argument name.
 * @param schema - Its string schema.
 * @param value - The present value.
 * @returns The problem, or undefined.
 * @example
 * ```ts
 * stringProblem("format", { type: "string", enum: ["jpeg", "png"], description: "" }, "gif"); // "format must be one of jpeg, png"
 * ```
 */
function stringProblem(
  name: string,
  schema: Extract<PropertySchema, { readonly type: "string" }>,
  value: Json
): string | undefined {
  if (typeof value !== "string") return `${name} must be a string`;
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    return `${name} must not be empty`;
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return `${name} must be one of ${schema.enum.join(", ")}`;
  }
  return undefined;
}

/**
 * Why a present value is not a plain number at least its minimum, or undefined when it is one.
 *
 * @param name - The argument name, such as `x` or `rect.w`.
 * @param schema - Its number schema.
 * @param value - The present value.
 * @returns The problem, or undefined.
 * @example
 * ```ts
 * numberProblem("x", { type: "number", description: "" }, "1"); // "x must be a number"
 * numberProblem("rect.w", { type: "number", minimum: 1, description: "" }, 0.5); // "rect.w must be at least 1"
 * ```
 */
function numberProblem(name: string, schema: NumberFieldSchema, value: Json): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return `${name} must be a number`;
  return schema.minimum !== undefined && value < schema.minimum
    ? `${name} must be at least ${String(schema.minimum)}`
    : undefined;
}

/**
 * Why a present object does not fit its property: not an object, an unknown or missing field, or
 * a field that is not a number at least its minimum.
 *
 * @param name - The argument name.
 * @param schema - Its object schema.
 * @param value - The present value.
 * @returns The problem, or undefined.
 * @example
 * ```ts
 * objectProblem("rect", RECT_PROPERTY, { x: 0, y: 0, w: 0, h: 1 }); // "rect.w must be at least 1"
 * ```
 */
function objectProblem(name: string, schema: ObjectSchema, value: Json): string | undefined {
  if (!isObject(value)) return `${name} must be an object`;

  // No field the schema does not know.
  for (const field of Object.keys(value)) {
    if (!Object.hasOwn(schema.properties, field))
      return `${name}.${field} is not a field of ${name}`;
  }
  // Every required field present.
  for (const field of schema.required) {
    if (value[field] === undefined) return `${name}.${field} is required`;
  }
  // Every present field a number at least its minimum.
  for (const [field, property] of Object.entries(schema.properties)) {
    const member = value[field];
    const problem =
      member === undefined ? undefined : numberProblem(`${name}.${field}`, property, member);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * Why a present value does not fit its property, or undefined when it fits.
 *
 * @param name - The argument name.
 * @param schema - Its property schema.
 * @param value - The present value.
 * @returns The problem, or undefined.
 * @example
 * ```ts
 * valueProblem("frames", { type: "integer", description: "", minimum: 2, maximum: 12 }, 20); // "frames must be at most 12"
 * ```
 */
function valueProblem(name: string, schema: PropertySchema, value: Json): string | undefined {
  if (!("type" in schema)) return undefined;
  switch (schema.type) {
    case "string": {
      return stringProblem(name, schema, value);
    }
    case "object": {
      return objectProblem(name, schema, value);
    }
    case "number": {
      return numberProblem(name, schema, value);
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `${name} must be a whole number`;
      }
      if (value < schema.minimum) return `${name} must be at least ${String(schema.minimum)}`;
      return value > schema.maximum
        ? `${name} must be at most ${String(schema.maximum)}`
        : undefined;
    }
    default: {
      return typeof value === "boolean" ? undefined : `${name} must be true or false`;
    }
  }
}

/**
 * Checks the `arguments` of a tool call: an object (absent means `{}`), no unknown name, every
 * required name present, every value of the right kind.
 *
 * @param schema - The tool's input schema.
 * @param raw - The `arguments` member, or undefined.
 * @returns The checked arguments, or the first problem as a message.
 * @example
 * ```ts
 * checkArguments(SCREENSHOT_SCHEMA, { maxWidth: 540 }); // { maxWidth: 540 }
 * checkArguments(SCREENSHOT_SCHEMA, { scale: 2 }); // "scale is not an argument of this tool"
 * ```
 */
export function checkArguments(
  schema: ToolInputSchema,
  raw: Json | undefined
): JsonObject | string {
  const args = raw ?? {};
  if (!isObject(args)) return "arguments must be an object";

  // No argument the tool does not know.
  for (const name of Object.keys(args)) {
    if (!Object.hasOwn(schema.properties, name)) return `${name} is not an argument of this tool`;
  }
  // Every required argument present.
  for (const name of schema.required ?? []) {
    if (args[name] === undefined) return `${name} is required`;
  }
  // Every present argument of the right kind.
  for (const [name, property] of Object.entries(schema.properties)) {
    const value = args[name];
    const problem = value === undefined ? undefined : valueProblem(name, property, value);
    if (problem !== undefined) return problem;
  }
  return args;
}

/**
 * A checked string argument, or undefined when absent.
 *
 * @param args - The checked arguments.
 * @param name - The argument.
 * @returns The string.
 * @example
 * ```ts
 * textArgument({ id: "game.position" }, "id"); // "game.position"
 * ```
 */
export function textArgument(args: JsonObject, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * A checked integer argument, or the fallback when absent.
 *
 * @param args - The checked arguments.
 * @param name - The argument.
 * @param fallback - The default.
 * @returns The number.
 * @example
 * ```ts
 * numberArgument({}, "maxWidth", 1080); // 1080
 * ```
 */
export function numberArgument(args: JsonObject, name: string, fallback: number): number {
  const value = args[name];
  return typeof value === "number" ? value : fallback;
}

/**
 * A checked optional integer argument, or undefined when absent.
 *
 * @param args - The checked arguments.
 * @param name - The argument.
 * @returns The number.
 * @example
 * ```ts
 * optionalNumberArgument({ port: 3000 }, "port"); // 3000
 * ```
 */
export function optionalNumberArgument(args: JsonObject, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" ? value : undefined;
}

/**
 * A checked boolean argument, or the fallback when absent.
 *
 * @param args - The checked arguments.
 * @param name - The argument.
 * @param fallback - The default.
 * @returns The flag.
 * @example
 * ```ts
 * flagArgument({ restore: false }, "restore", true); // false
 * ```
 */
export function flagArgument(args: JsonObject, name: string, fallback: boolean): boolean {
  const value = args[name];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * A checked rect argument (`{ x, y, w, h }`), or undefined when absent.
 *
 * @param args - The checked arguments.
 * @param name - The argument.
 * @returns The rect.
 * @example
 * ```ts
 * rectArgument({ rect: { x: 0, y: 30, w: 200, h: 60 } }, "rect"); // { x: 0, y: 30, w: 200, h: 60 }
 * ```
 */
export function rectArgument(args: JsonObject, name: string): SelectionRect | undefined {
  const value = args[name];
  if (!isObject(value)) return undefined;

  const { x, y, w, h } = value;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (typeof w !== "number" || typeof h !== "number") return undefined;
  return { x, y, w, h };
}

/**
 * An area of the game page in CSS px (the iframe viewport): `{ x, y, w, h }`.
 */
export const RECT_PROPERTY: PropertySchema = {
  type: "object",
  description:
    "An area of the game page in CSS px, the way the Reference picker drag draws it: { x, y, w, h }.",
  properties: {
    x: { type: "number", minimum: 0, description: "Left edge, CSS px." },
    y: { type: "number", minimum: 0, description: "Top edge, CSS px." },
    w: { type: "number", minimum: 1, description: "Width, CSS px." },
    h: { type: "number", minimum: 1, description: "Height, CSS px." }
  },
  required: ["x", "y", "w", "h"],
  additionalProperties: false
};

/**
 * The optional `session` argument of every game tool.
 */
export const SESSION_PROPERTY: PropertySchema = {
  type: "string",
  minLength: 1,
  description:
    "Game session id from moku_sessions. Omit it when one game is connected, or one is embedded in the tools page."
};

/**
 * The optional `input` argument of a source or command.
 */
export const INPUT_PROPERTY: PropertySchema = {
  description:
    'The input of the source or command: a JSON object such as { "frames": 1 }. Omit it when it takes none (moku_manifest lists the input kinds).'
};

/**
 * The input schema of a tool without arguments.
 */
export const NO_ARGUMENTS: ToolInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

/**
 * The annotations of a tool that only reads.
 */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
