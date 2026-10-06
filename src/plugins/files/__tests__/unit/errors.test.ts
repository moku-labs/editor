import { describe, expect, it } from "vitest";
import { isWireError } from "../../../registry/protocol";
import { conflict, forbidden, invalid, ioFailed, notFound, tooLarge } from "../../errors";

const ROOT_REAL = "/home/dev/game";

describe("files errors", () => {
  it.each([
    ["forbidden", forbidden("../x.ts"), -32_004, { reason: "forbidden_path", id: "../x.ts" }],
    ["notFound", notFound("src/x.ts"), -32_601, { reason: "unknown_id", id: "src/x.ts" }],
    ["conflict", conflict("src/x.ts"), -32_005, { reason: "version_conflict", id: "src/x.ts" }],
    [
      "invalid",
      invalid("text", "text over 2 MiB: a.ts"),
      -32_602,
      { reason: "invalid_input", field: "text" }
    ],
    [
      "invalid data",
      invalid("data", "bad data URL"),
      -32_602,
      { reason: "invalid_input", field: "data" }
    ],
    ["tooLarge", tooLarge("src/big.ts"), -32_000, { reason: "command_failed" }],
    ["ioFailed", ioFailed("write failed: a.ts (EACCES)"), -32_000, { reason: "command_failed" }]
  ])("%s is a wire error with its code and data", (_name, error, code, data) => {
    expect(error).toBeInstanceOf(Error);
    expect(isWireError(error)).toBe(true);
    expect(error.code).toBe(code);
    expect(error.data).toEqual({ ...data, retryable: false });
    expect(error.message.startsWith("[moku-editor] ")).toBe(true);
    expect(error.message).not.toContain(ROOT_REAL);
  });

  it("names the requested path in the message", () => {
    expect(forbidden("../x.ts").message).toBe("[moku-editor] forbidden path: ../x.ts");
    expect(notFound("src/x.ts").message).toContain("src/x.ts");
    expect(conflict("src/x.ts").message).toContain("src/x.ts");
    expect(tooLarge("src/big.ts").message).toContain("src/big.ts");
  });

  it("keeps a prefixed message prefixed once", () => {
    expect(ioFailed("[moku-editor] boom").message).toBe("[moku-editor] boom");
    expect(invalid("data", "boom").message).toBe("[moku-editor] boom");
  });
});
