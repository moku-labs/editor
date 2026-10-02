import { describe, expect, it } from "vitest";
import { backoffDelay } from "../../socket/backoff";

describe("backoffDelay", () => {
  it("doubles from the base and caps at 8 s", () => {
    expect([0, 1, 2, 3, 4].map(attempt => backoffDelay(attempt, 1000))).toEqual([
      1000, 2000, 4000, 8000, 8000
    ]);
  });

  it("uses the configured base", () => {
    expect(backoffDelay(0, 250)).toBe(250);
    expect(backoffDelay(2, 250)).toBe(1000);
  });
});
