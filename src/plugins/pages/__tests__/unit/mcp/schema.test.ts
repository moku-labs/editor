/* eslint-disable unicorn/no-null -- null is a JSON value */
import { describe, expect, it } from "vitest";
import {
  checkArguments,
  flagArgument,
  numberArgument,
  optionalNumberArgument,
  textArgument
} from "../../../mcp/schema";
import type { ToolInputSchema } from "../../../mcp/types";

// ─────────────────────────────────────────────────────────────────────────────
// pages/mcp schema: tool arguments are checked against the tool's JSON Schema
// subset; a problem is a message for an isError result.
// ─────────────────────────────────────────────────────────────────────────────

/** A schema with every property kind. */
const SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, description: "id" },
    frames: { type: "integer", minimum: 2, maximum: 12, description: "frames" },
    restore: { type: "boolean", description: "restore" },
    input: { description: "any JSON" }
  },
  required: ["id"],
  additionalProperties: false
};

describe("checkArguments", () => {
  it("accepts the arguments and any JSON for a property without type", () => {
    const args = { id: "game.step", frames: 2, restore: false, input: [1, { a: null }] };
    expect(checkArguments(SCHEMA, args)).toEqual(args);
  });

  it("reads absent arguments as {}", () => {
    expect(checkArguments({ ...SCHEMA, required: [] }, undefined)).toEqual({});
  });

  it("names the first problem", () => {
    expect(checkArguments(SCHEMA, [])).toBe("arguments must be an object");
    expect(checkArguments(SCHEMA, { id: "x", scale: 2 })).toBe(
      "scale is not an argument of this tool"
    );
    expect(checkArguments(SCHEMA, {})).toBe("id is required");
    expect(checkArguments(SCHEMA, { id: 1 })).toBe("id must be a string");
    expect(checkArguments(SCHEMA, { id: "" })).toBe("id must not be empty");
    expect(checkArguments(SCHEMA, { id: "x", frames: 2.5 })).toBe("frames must be a whole number");
    expect(checkArguments(SCHEMA, { id: "x", frames: 1 })).toBe("frames must be at least 2");
    expect(checkArguments(SCHEMA, { id: "x", frames: 13 })).toBe("frames must be at most 12");
    expect(checkArguments(SCHEMA, { id: "x", restore: "yes" })).toBe(
      "restore must be true or false"
    );
  });
});

describe("argument readers", () => {
  it("read checked values or the fallback", () => {
    const args = { id: "a", frames: 3, restore: false };
    expect(textArgument(args, "id")).toBe("a");
    expect(textArgument(args, "nope")).toBeUndefined();
    expect(numberArgument(args, "frames", 6)).toBe(3);
    expect(numberArgument(args, "nope", 6)).toBe(6);
    expect(optionalNumberArgument(args, "frames")).toBe(3);
    expect(optionalNumberArgument(args, "nope")).toBeUndefined();
    expect(flagArgument(args, "restore", true)).toBe(false);
    expect(flagArgument(args, "nope", true)).toBe(true);
  });
});
