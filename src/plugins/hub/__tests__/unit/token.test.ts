import { describe, expect, it } from "vitest";
import { newToken, sameToken } from "../../security/token";

describe("newToken", () => {
  it("is 32 random bytes in base64url: 43 url-safe characters", () => {
    const token = newToken();

    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[\w-]{43}$/);
  });

  it("differs on every call", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => newToken()));

    expect(tokens.size).toBe(20);
  });
});

describe("sameToken", () => {
  const expected = newToken();

  it("accepts the token of this start", () => {
    expect(sameToken(expected, expected)).toBe(true);
  });

  it("refuses a wrong token of the same length (H2)", () => {
    const wrong = `${expected.slice(0, -1)}${expected.endsWith("A") ? "B" : "A"}`;

    expect(sameToken(wrong, expected)).toBe(false);
  });

  it("refuses a token of another length without throwing (H3)", () => {
    expect(() => sameToken("short", expected)).not.toThrow();
    expect(sameToken("short", expected)).toBe(false);
    expect(sameToken(`${expected}x`, expected)).toBe(false);
  });

  it("refuses an empty token (H1)", () => {
    expect(sameToken("", expected)).toBe(false);
  });

  it("compares bytes: a multi-byte string of the same length does not throw", () => {
    const multiByte = "é".repeat(43);

    expect(() => sameToken(multiByte, expected)).not.toThrow();
    expect(sameToken(multiByte, expected)).toBe(false);
  });
});
