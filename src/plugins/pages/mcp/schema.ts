/**
 * @file pages/mcp — checks the arguments of a tool call against its input schema (the JSON Schema
 * subset of `PropertySchema`: string, integer with a range, boolean, any JSON) and reads the
 * checked values. A problem is a message for an `isError` result, so the model can fix the call.
 */
import type { Json } from "../../registry/protocol";
import { isObject } from "./rpc";
import type { JsonObject, PropertySchema, ToolAnnotations, ToolInputSchema } from "./types";

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
      if (typeof value !== "string") return `${name} must be a string`;
      const tooShort = schema.minLength !== undefined && value.length < schema.minLength;
      return tooShort ? `${name} must not be empty` : undefined;
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

  for (const name of Object.keys(args)) {
    if (!Object.hasOwn(schema.properties, name)) return `${name} is not an argument of this tool`;
  }
  for (const name of schema.required ?? []) {
    if (args[name] === undefined) return `${name} is required`;
  }
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
