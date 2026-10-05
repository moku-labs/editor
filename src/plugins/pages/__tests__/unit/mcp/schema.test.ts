/* eslint-disable unicorn/no-null -- null is a JSON value */
import { describe, expect, it } from "vitest";
import {
  checkArguments,
  flagArgument,
  numberArgument,
  optionalNumberArgument,
  RECT_PROPERTY,
  rectArgument,
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

describe("enum strings and the rect object", () => {
  /** A schema with an enum string and a rect. */
  const PICTURE: ToolInputSchema = {
    type: "object",
    properties: {
      format: { type: "string", enum: ["jpeg", "png"], default: "jpeg", description: "format" },
      rect: RECT_PROPERTY
    },
    additionalProperties: false
  };

  it("accepts a listed string and a rect of four numbers", () => {
    const args = { format: "png", rect: { x: 0, y: 30.5, w: 200, h: 60 } };
    expect(checkArguments(PICTURE, args)).toEqual(args);
  });

  it("names the problem of an unlisted string or a bad rect", () => {
    expect(checkArguments(PICTURE, { format: "gif" })).toBe("format must be one of jpeg, png");
    expect(checkArguments(PICTURE, { rect: [1, 2] })).toBe("rect must be an object");
    expect(checkArguments(PICTURE, { rect: { x: 0, y: 0, w: 1 } })).toBe("rect.h is required");
    expect(checkArguments(PICTURE, { rect: { x: 0, y: 0, w: 1, h: 1, z: 2 } })).toBe(
      "rect.z is not a field of rect"
    );
    expect(checkArguments(PICTURE, { rect: { x: "0", y: 0, w: 1, h: 1 } })).toBe(
      "rect.x must be a number"
    );
    expect(checkArguments(PICTURE, { rect: { x: -1, y: 0, w: 1, h: 1 } })).toBe(
      "rect.x must be at least 0"
    );
    expect(checkArguments(PICTURE, { rect: { x: 0, y: 0, w: 0, h: 1 } })).toBe(
      "rect.w must be at least 1"
    );
  });

  it("reads a checked rect, or undefined when absent", () => {
    const rect = { x: 1, y: 2, w: 3, h: 4 };
    expect(rectArgument({ rect }, "rect")).toEqual(rect);
    expect(rectArgument({}, "rect")).toBeUndefined();
    expect(rectArgument({ rect: { x: 1 } }, "rect")).toBeUndefined();
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
