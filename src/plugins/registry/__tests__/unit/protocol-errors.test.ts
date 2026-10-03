/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { describe, expect, it } from "vitest";
import type { ErrorReason, WireError } from "../../protocol";
import * as protocol from "../../protocol";
import {
  bareMessage,
  ERROR_PREFIX,
  errorCode,
  fromWireError,
  isRetryable,
  isWireError,
  ProtocolError,
  toWireError,
  wireError
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Error codes: the reason → code table of 01-registry (contracts §2, R1, R6, R7)
// ─────────────────────────────────────────────────────────────────────────────

const reasonTable: readonly [ErrorReason, number, boolean][] = [
  ["game_reloaded", -32_001, true],
  ["timeout", -32_002, true],
  ["link_closed", -32_002, true],
  ["no_session", -32_003, false],
  ["choose_session", -32_003, false],
  ["invalid_input", -32_602, false],
  ["unknown_id", -32_601, false],
  ["command_failed", -32_000, false],
  ["not_json", -32_006, false],
  ["forbidden_path", -32_004, false],
  ["version_conflict", -32_005, false],
  ["unauthorized", -32_007, false]
];

describe("errorCode", () => {
  it("names every code of the contracts and R6", () => {
    expect(errorCode).toEqual({
      invalidRequest: -32_600,
      unknownMethod: -32_601,
      invalidInput: -32_602,
      commandFailed: -32_000,
      gameReloaded: -32_001,
      timeout: -32_002,
      noSession: -32_003,
      forbiddenPath: -32_004,
      versionConflict: -32_005,
      notJson: -32_006,
      unauthorized: -32_007
    });
  });

  it.each(
    reasonTable
  )("builds %s with code %i, retryable %s by the reason table", (reason, code, retryable) => {
    const error = wireError(code, "it failed", { reason, retryable });

    expect(error.code).toBe(code);
    expect(error.data).toEqual({ reason, retryable });
    expect(isRetryable(error)).toBe(retryable);
  });

  it("has no protocolError helper (R7)", () => {
    expect("protocolError" in protocol).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prefix and bareMessage
// ─────────────────────────────────────────────────────────────────────────────

describe("message prefix", () => {
  it("is exactly '[moku-editor] '", () => {
    expect(ERROR_PREFIX).toBe("[moku-editor] ");
  });

  it("wireError adds the prefix when the message lacks it", () => {
    expect(wireError(-32_602, "frames must be a number").message).toBe(
      "[moku-editor] frames must be a number"
    );
  });

  it("wireError never adds the prefix twice", () => {
    expect(wireError(-32_602, "[moku-editor] frames must be a number").message).toBe(
      "[moku-editor] frames must be a number"
    );
  });

  it("toWireError of a plain Error starts with the prefix exactly once", () => {
    expect(toWireError(new Error("boom")).message).toBe("[moku-editor] boom");
    expect(toWireError(new Error("[moku-editor] boom")).message).toBe("[moku-editor] boom");
  });

  it("bareMessage strips the prefix", () => {
    expect(bareMessage("[moku-editor] game.step: frames must be a number")).toBe(
      "game.step: frames must be a number"
    );
  });

  it("bareMessage leaves a message without the prefix alone", () => {
    expect(bareMessage("frames must be a number")).toBe("frames must be a number");
    expect(bareMessage("[game] Control commands run in dev builds only.")).toBe(
      "[game] Control commands run in dev builds only."
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ProtocolError
// ─────────────────────────────────────────────────────────────────────────────

describe("ProtocolError", () => {
  it("is an Error with name, code, message and data", () => {
    const error = new ProtocolError(-32_602, "[moku-editor] bad", {
      reason: "invalid_input",
      field: "frames"
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ProtocolError");
    expect(error.code).toBe(-32_602);
    expect(error.message).toBe("[moku-editor] bad");
    expect(error.data).toEqual({ reason: "invalid_input", field: "frames" });
  });

  it("has no data key when no data is given", () => {
    const error = new ProtocolError(-32_000, "[moku-editor] bad");

    expect(error.data).toBeUndefined();
    expect(Object.hasOwn(error, "data")).toBe(false);
  });

  it("wire is the plain WireError and omits undefined data", () => {
    const bare = new ProtocolError(-32_000, "[moku-editor] bad");
    const withData = new ProtocolError(-32_001, "[moku-editor] reloaded", {
      reason: "game_reloaded",
      retryable: true
    });

    expect(bare.wire).toEqual({ code: -32_000, message: "[moku-editor] bad" });
    expect(Object.keys(bare.wire)).toEqual(["code", "message"]);
    expect(withData.wire).toEqual({
      code: -32_001,
      message: "[moku-editor] reloaded",
      data: { reason: "game_reloaded", retryable: true }
    });
    expect(Object.getPrototypeOf(withData.wire)).toBe(Object.prototype);
    expect(structuredClone(withData.wire)).toEqual(withData.wire);
  });

  it("wireError returns a ProtocolError", () => {
    const error = wireError(-32_004, "forbidden path: ../x.ts", {
      reason: "forbidden_path",
      retryable: false,
      id: "../x.ts"
    });

    expect(error).toBeInstanceOf(ProtocolError);
    expect(error.data).toEqual({ reason: "forbidden_path", retryable: false, id: "../x.ts" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isWireError
// ─────────────────────────────────────────────────────────────────────────────

describe("isWireError", () => {
  it("is true for a ProtocolError", () => {
    expect(isWireError(wireError(-32_000, "x"))).toBe(true);
  });

  it("is true for a FilesError-like Error with code and data", () => {
    const filesError = Object.assign(new Error("[moku-editor] forbidden path"), {
      code: -32_004,
      data: { reason: "forbidden_path", retryable: false }
    });

    expect(isWireError(filesError)).toBe(true);
  });

  it("is true for a decoded error member", () => {
    const decoded: unknown = JSON.parse('{"code":-32001,"message":"[moku-editor] gone","data":{}}');

    expect(isWireError(decoded)).toBe(true);
    expect(isWireError({ code: -32_602, message: "m" })).toBe(true);
  });

  it.each([
    ["a string code", { code: "1", message: "m" }],
    ["a fractional code", { code: 1.5, message: "m" }],
    ["a missing message", { code: 1 }],
    ["a number message", { code: 1, message: 2 }],
    ["array data", { code: 1, message: "m", data: [] }],
    ["null data", { code: 1, message: "m", data: null }],
    ["string data", { code: 1, message: "m", data: "x" }],
    ["null", null],
    ["a string", "boom"],
    ["undefined", undefined],
    ["a plain Error", new Error("boom")]
  ])("is false for %s", (_label, value) => {
    expect(isWireError(value)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toWireError
// ─────────────────────────────────────────────────────────────────────────────

describe("toWireError", () => {
  it("copies a ProtocolError without its stack", () => {
    const error = wireError(-32_602, "frames must be a number", {
      reason: "invalid_input",
      retryable: false,
      field: "frames"
    });
    const wire = toWireError(error);

    expect(wire).toEqual({
      code: -32_602,
      message: "[moku-editor] frames must be a number",
      data: { reason: "invalid_input", retryable: false, field: "frames" }
    });
    expect(wire).not.toBeInstanceOf(Error);
    expect("stack" in wire).toBe(false);
    expect(wire.data).not.toBe(error.data);
  });

  it("copies a wire-error-like object and adds the prefix when it lacks it", () => {
    expect(
      toWireError({ code: -32_005, message: "stale", data: { reason: "version_conflict" } })
    ).toEqual({
      code: -32_005,
      message: "[moku-editor] stale",
      data: { reason: "version_conflict" }
    });
  });

  it("omits the data key of a wire error without data", () => {
    const wire = toWireError({ code: -32_601, message: "[moku-editor] unknown id" });

    expect(Object.keys(wire)).toEqual(["code", "message"]);
  });

  it("drops unknown data keys", () => {
    const wire = toWireError({
      code: -32_000,
      message: "[moku-editor] x",
      data: { reason: "command_failed", stack: "at x", id: "game.step" }
    });

    expect(wire.data).toEqual({ reason: "command_failed", id: "game.step" });
  });

  it("uses the wire property of an Error that carries one", () => {
    const error = Object.assign(new Error("outer"), {
      wire: { code: -32_003, message: "[moku-editor] no session", data: { reason: "no_session" } }
    });

    expect(toWireError(error)).toEqual({
      code: -32_003,
      message: "[moku-editor] no session",
      data: { reason: "no_session" }
    });
  });

  it("maps a plain Error to -32000 command_failed", () => {
    expect(toWireError(new TypeError("x is undefined"))).toEqual({
      code: -32_000,
      message: "[moku-editor] x is undefined",
      data: { reason: "command_failed", retryable: false }
    });
  });

  it("maps an Error whose wire property is not a wire error to -32000", () => {
    const error = Object.assign(new Error("odd"), { wire: "nope" });

    expect(toWireError(error).code).toBe(-32_000);
  });

  it.each([
    ["a string", "boom"],
    ["a number", 42],
    ["undefined", undefined]
  ])("maps %s to -32000 Unknown error", (_label, value) => {
    expect(toWireError(value)).toEqual({
      code: -32_000,
      message: "[moku-editor] Unknown error",
      data: { reason: "command_failed", retryable: false }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isRetryable and fromWireError
// ─────────────────────────────────────────────────────────────────────────────

describe("isRetryable", () => {
  it("is true for -32001 and -32002 without data", () => {
    expect(isRetryable({ code: -32_001, message: "m" })).toBe(true);
    expect(isRetryable({ code: -32_002, message: "m" })).toBe(true);
  });

  it("is true for retryable: true with any other code", () => {
    expect(isRetryable(wireError(-32_000, "m", { retryable: true }))).toBe(true);
  });

  it("is false for other codes, non wire errors and nothing", () => {
    expect(isRetryable(wireError(-32_000, "m"))).toBe(false);
    expect(isRetryable(wireError(-32_602, "m", { retryable: false }))).toBe(false);
    expect(isRetryable(new Error("timeout"))).toBe(false);
    expect(isRetryable("timeout")).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe("fromWireError", () => {
  it("rebuilds a ProtocolError from its wire form", () => {
    const original = new ProtocolError(-32_001, "[moku-editor] game reloaded", {
      reason: "game_reloaded",
      retryable: true,
      id: "game.step"
    });
    const rebuilt = fromWireError(original.wire);

    expect(rebuilt).toBeInstanceOf(ProtocolError);
    expect(rebuilt.wire).toEqual(original.wire);
    expect(isRetryable(rebuilt)).toBe(true);
  });

  it("keeps the data key absent when the wire error has none", () => {
    const wire: WireError = { code: -32_601, message: "[moku-editor] unknown id" };
    const rebuilt = fromWireError(wire);

    expect(Object.hasOwn(rebuilt, "data")).toBe(false);
    expect(rebuilt.message).toBe("[moku-editor] unknown id");
  });

  it("adds the prefix to a message that lacks it", () => {
    expect(fromWireError({ code: -32_000, message: "boom" }).message).toBe("[moku-editor] boom");
  });
});
