/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { describe, expect, it } from "vitest";
import type { Message, Response } from "../../protocol";
import {
  decode,
  encode,
  failure,
  isFailure,
  isNotification,
  isRequest,
  isResponse,
  notification,
  ProtocolError,
  request,
  success
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// decode — row by row of the 01-registry table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decodes and returns the thrown ProtocolError.
 *
 * @param text - Received text.
 * @returns The error.
 */
function failureOf(text: string): ProtocolError {
  try {
    decode(text);
  } catch (error) {
    if (error instanceof ProtocolError) return error;
    throw error;
  }
  throw new Error("decode did not throw");
}

/**
 * JSON text of a value.
 *
 * @param value - Any value.
 * @returns Its JSON.
 */
const text = (value: unknown): string => JSON.stringify(value);

const base = { jsonrpc: "2.0" };

describe("decode", () => {
  it.each([
    ["JSON.parse fails", "{nope", "message is not JSON"],
    [
      "the top level is an array",
      text([{ ...base, id: 1, result: 1 }]),
      "batches are not supported"
    ],
    ["the top level is a string", text("hi"), "message must be an object"],
    ["the top level is null", "null", "message must be an object"],
    ["jsonrpc is missing", text({ id: 1, result: 1 }), 'jsonrpc must be "2.0"'],
    ["jsonrpc is 1.0", text({ jsonrpc: "1.0", id: 1, result: 1 }), 'jsonrpc must be "2.0"'],
    [
      "method is empty",
      text({ ...base, channel: "game", method: "" }),
      "method must be a non-empty string"
    ],
    [
      "method is a number",
      text({ ...base, channel: "game", method: 1 }),
      "method must be a non-empty string"
    ],
    [
      "method is longer than 128",
      text({ ...base, channel: "game", method: "m".repeat(129) }),
      "method must be a non-empty string"
    ],
    [
      "channel is missing",
      text({ ...base, method: "run" }),
      "channel must be game, files or editor"
    ],
    [
      "channel is unknown",
      text({ ...base, channel: "mcp", method: "run" }),
      "channel must be game, files or editor"
    ],
    [
      "params is a string",
      text({ ...base, channel: "game", method: "run", params: "x" }),
      "params must be an object or an array"
    ],
    [
      "params is null",
      text({ ...base, channel: "game", method: "run", params: null }),
      "params must be an object or an array"
    ],
    [
      "session is empty",
      text({ ...base, channel: "game", method: "run", session: "" }),
      "session must be a non-empty string"
    ],
    [
      "session is a number",
      text({ ...base, channel: "game", method: "run", session: 7 }),
      "session must be a non-empty string"
    ],
    [
      "id is null",
      text({ ...base, channel: "game", method: "run", id: null }),
      "id must be an integer"
    ],
    ["id is a string", text({ ...base, id: "1", result: 1 }), "id must be an integer"],
    ["id is fractional", text({ ...base, id: 1.5, result: 1 }), "id must be an integer"],
    ["id is not safe", text({ ...base, id: 2 ** 60, result: 1 }), "id must be an integer"],
    ["a response has no id", text({ ...base, result: 1 }), "a response needs an id"],
    [
      "a response has result and error",
      text({ ...base, id: 1, result: 1, error: { code: 1, message: "m" } }),
      "a response has exactly one of result and error"
    ],
    [
      "a response has neither",
      text({ ...base, id: 1 }),
      "a response has exactly one of result and error"
    ],
    [
      "error has no code",
      text({ ...base, id: 1, error: { message: "m" } }),
      "error must have a code and a message"
    ],
    [
      "error code is fractional",
      text({ ...base, id: 1, error: { code: 1.5, message: "m" } }),
      "error must have a code and a message"
    ],
    [
      "error has no message",
      text({ ...base, id: 1, error: { code: 1 } }),
      "error must have a code and a message"
    ],
    [
      "error data is an array",
      text({ ...base, id: 1, error: { code: 1, message: "m", data: [] } }),
      "error must have a code and a message"
    ],
    [
      "error is a string",
      text({ ...base, id: 1, error: "boom" }),
      "error must have a code and a message"
    ]
  ])("rejects when %s", (_label, input, message) => {
    const error = failureOf(input);

    expect(error.code).toBe(-32_600);
    expect(error.message).toBe(`[moku-editor] ${message}`);
  });

  it("decodes a request (method + id)", () => {
    const message = decode(
      text({
        ...base,
        id: 7,
        channel: "game",
        method: "run",
        params: { id: "game.step" },
        session: "s-1"
      })
    );

    expect(message).toEqual({
      jsonrpc: "2.0",
      id: 7,
      channel: "game",
      method: "run",
      params: { id: "game.step" },
      session: "s-1"
    });
    expect(isRequest(message)).toBe(true);
  });

  it("decodes a notification (method, no id) with array params", () => {
    const message = decode(
      text({ ...base, channel: "editor", method: "sessions", params: [1, 2] })
    );

    expect(message).toEqual({
      jsonrpc: "2.0",
      channel: "editor",
      method: "sessions",
      params: [1, 2]
    });
    expect(isNotification(message)).toBe(true);
  });

  it("decodes a success response, result null included", () => {
    const message = decode(text({ ...base, id: 3, result: null }));

    expect(message).toEqual({ jsonrpc: "2.0", id: 3, result: null });
    expect(isResponse(message)).toBe(true);
  });

  it("decodes an error response and keeps the known data keys", () => {
    const message = decode(
      text({
        ...base,
        id: 3,
        error: {
          code: -32_001,
          message: "[moku-editor] reloaded",
          data: {
            reason: "game_reloaded",
            retryable: true,
            id: "game.step",
            field: "f",
            stack: "x"
          }
        }
      })
    );

    expect(message).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32_001,
        message: "[moku-editor] reloaded",
        data: { reason: "game_reloaded", retryable: true, id: "game.step", field: "f" }
      }
    });
  });

  it("keeps the not_installed reason of a -32008 answer", () => {
    const message = decode(
      text({
        ...base,
        id: 4,
        error: {
          code: -32_008,
          message: "[moku-editor] source game.effects is not available in this game: boom",
          data: { reason: "not_installed", retryable: false, id: "game.effects" }
        }
      })
    );

    expect(message).toMatchObject({
      error: { code: -32_008, data: { reason: "not_installed", retryable: false } }
    });
  });

  it("drops data keys of the wrong type", () => {
    const message = decode(
      text({
        ...base,
        id: 3,
        error: { code: 1, message: "m", data: { reason: "nope", retryable: "yes", id: 5 } }
      })
    );

    expect(message).toEqual({ jsonrpc: "2.0", id: 3, error: { code: 1, message: "m", data: {} } });
  });

  it("drops unknown extra keys", () => {
    const message = decode(
      text({ ...base, id: 1, channel: "game", method: "read", extra: 1, params: {}, result: 5 })
    );

    expect(message).toEqual({ jsonrpc: "2.0", id: 1, channel: "game", method: "read", params: {} });
    expect(Object.keys(decode(text({ ...base, id: 2, result: 1, channel: "game" })))).toEqual([
      "jsonrpc",
      "id",
      "result"
    ]);
  });

  it("returns a fresh object every time", () => {
    const input = text({ ...base, id: 1, result: { a: 1 } });

    expect(decode(input)).not.toBe(decode(input));
  });

  it("does not look at method names", () => {
    expect(decode(text({ ...base, channel: "files", method: "anything.goes" }))).toMatchObject({
      method: "anything.goes"
    });
  });

  it("accepts a method of exactly 128 characters", () => {
    expect(decode(text({ ...base, channel: "game", method: "m".repeat(128) }))).toMatchObject({
      channel: "game"
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Builders, encode and round trips
// ─────────────────────────────────────────────────────────────────────────────

describe("builders", () => {
  it("request omits undefined params and session", () => {
    const message = request(1, "game", "manifest");

    expect(message).toEqual({ jsonrpc: "2.0", id: 1, channel: "game", method: "manifest" });
    expect(Object.keys(message)).toEqual(["jsonrpc", "id", "channel", "method"]);
  });

  it("request carries params and session when given", () => {
    expect(request(7, "game", "run", { id: "game.step", input: { frames: 1 } }, "s-7f3a")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      channel: "game",
      method: "run",
      params: { id: "game.step", input: { frames: 1 } },
      session: "s-7f3a"
    });
  });

  it("request keeps null params", () => {
    expect(request(2, "files", "list", null)).toHaveProperty("params", null);
  });

  it("notification omits undefined params and session", () => {
    expect(notification("game", "bye")).toEqual({ jsonrpc: "2.0", channel: "game", method: "bye" });
    expect(notification("editor", "session", { id: "s" }, "s")).toEqual({
      jsonrpc: "2.0",
      channel: "editor",
      method: "session",
      params: { id: "s" },
      session: "s"
    });
  });

  it("success and failure build responses", () => {
    expect(success(7, null)).toEqual({ jsonrpc: "2.0", id: 7, result: null });
    expect(failure(7, { code: -32_601, message: "[moku-editor] unknown id" })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32_601, message: "[moku-editor] unknown id" }
    });
  });

  it("encode is JSON.stringify", () => {
    const message = success(1, { a: [1] });

    expect(encode(message)).toBe(JSON.stringify(message));
  });

  it.each<[string, Message]>([
    ["request", request(1, "game", "watch", { sub: 0, id: "game.position" }, "s-1")],
    ["request without params", request(2, "game", "manifest")],
    ["notification", notification("game", "heartbeat", { frame: 1, paused: false, at: 9 })],
    ["notification without params", notification("game", "bye")],
    ["success", success(3, [1, "a", null])],
    [
      "failure",
      failure(4, {
        code: -32_602,
        message: "[moku-editor] game.step: frames must be a number",
        data: { reason: "invalid_input", retryable: false, field: "frames", id: "game.step" }
      })
    ],
    ["failure without data", failure(5, { code: -32_000, message: "[moku-editor] boom" })]
  ])("round-trips a %s through encode and decode", (_label, message) => {
    expect(decode(encode(message))).toEqual(message);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

describe("guards", () => {
  const req = request(1, "game", "read", { id: "game.graph" });
  const note = notification("game", "bye");
  const ok = success(1, 1);
  const bad = failure(1, { code: 1, message: "m" });

  it("isRequest is true for a request only", () => {
    expect([req, note, ok, bad].map(message => isRequest(message))).toEqual([
      true,
      false,
      false,
      false
    ]);
  });

  it("isNotification is true for a notification only", () => {
    expect([req, note, ok, bad].map(message => isNotification(message))).toEqual([
      false,
      true,
      false,
      false
    ]);
  });

  it("isResponse is true for responses only", () => {
    expect([req, note, ok, bad].map(message => isResponse(message))).toEqual([
      false,
      false,
      true,
      true
    ]);
  });

  it("isFailure is true for an error response only", () => {
    const responses: Response[] = [ok, bad];

    expect(responses.map(response => isFailure(response))).toEqual([false, true]);
  });

  it("narrows the message type", () => {
    const message: Message = decode(encode(bad));

    if (isResponse(message) && isFailure(message)) {
      expect(message.error.code).toBe(1);
    } else {
      throw new Error("expected an error response");
    }
  });
});
