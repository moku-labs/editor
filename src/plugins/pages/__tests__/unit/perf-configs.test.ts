import { describe, expect, it } from "vitest";
import { perfConfigOf } from "../../perf/plugin-configs";
import type { PerfArgs } from "../../perf/types";

const ARGS: PerfArgs = {
  kind: "perf",
  lan: false,
  port: 47_600,
  out: ".moku/perf",
  every: 10,
  ui: true
};

describe("perfConfigOf", () => {
  it("hands the perf run's phone to the collector, the only phone it reverses (bug E13: perf reversed every phone)", () => {
    expect(perfConfigOf({ ...ARGS, device: "R5CX1234" }, "/game", undefined).collector).toEqual({
      out: ".moku/perf",
      everyS: 10,
      device: "R5CX1234"
    });
    expect("device" in (perfConfigOf(ARGS, "/game", undefined).collector ?? {})).toBe(false);
  });
});
