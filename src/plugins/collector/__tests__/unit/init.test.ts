import { describe, expect, it } from "vitest";
import { initCollector, validateCollectorConfig } from "../../init";
import type { CollectorConfig } from "../../types";
import { createCtx, DEFAULT_CONFIG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The config checks of onInit: a TypeError in the two-line format per field.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The error a config change throws.
 *
 * @param change - The fields to change.
 * @returns The thrown value.
 */
function errorOf(change: Partial<CollectorConfig>): unknown {
  try {
    validateCollectorConfig({ ...DEFAULT_CONFIG, ...change });
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("validateCollectorConfig", () => {
  it.each([
    [{ out: "" }, '[moku-editor] collector.out is "".'],
    [{ everyS: 0 }, "[moku-editor] collector.everyS is 0."],
    [{ everyS: 3601 }, "[moku-editor] collector.everyS is 3601."],
    [{ everyS: 1.5 }, "[moku-editor] collector.everyS is 1.5."],
    [{ reverseEveryMs: 499 }, "[moku-editor] collector.reverseEveryMs is 499."],
    [{ adbTimeoutMs: 600.5 }, "[moku-editor] collector.adbTimeoutMs is 600.5."],
    [{ adb: "" }, '[moku-editor] collector.adb is "".'],
    [{ appId: "garden" }, '[moku-editor] collector.appId is "garden".'],
    [{ appId: "1com.example" }, '[moku-editor] collector.appId is "1com.example".'],
    [{ device: "R5; rm -rf /" }, '[moku-editor] collector.device is "R5; rm -rf /".'],
    [{ device: "" }, '[moku-editor] collector.device is "".'],
    [JSON.parse('{"out":42}'), "[moku-editor] collector.out is 42."],
    [JSON.parse('{"adb":7}'), "[moku-editor] collector.adb is 7."]
  ])("refuses %o with a two-line TypeError (bug: a one-line error with no fix)", (change, first) => {
    const error = errorOf(change);

    expect(error).toBeInstanceOf(TypeError);
    const lines = error instanceof Error ? error.message.split("\n") : [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(first);
    expect(lines[1]).toMatch(/^ {2}\S.*\.$/);
  });

  it("accepts the defaults, the bounds, an Android app id and adb serials", () => {
    expect(errorOf({})).toBeUndefined();
    expect(
      errorOf({
        everyS: 3600,
        reverseEveryMs: 500,
        adbTimeoutMs: 500,
        appId: "com.example.garden_2"
      })
    ).toBeUndefined();
    expect(errorOf({ device: "R5CY32V0J9M" })).toBeUndefined();
    expect(errorOf({ device: "emulator-5554" })).toBeUndefined();
    expect(errorOf({ device: "192.168.1.23:37011" })).toBeUndefined();
  });
});

describe("initCollector", () => {
  it("throws before it registers any route", () => {
    const ctx = createCtx("/tmp", { everyS: 0 });

    expect(() => initCollector(ctx)).toThrow(TypeError);
    expect(ctx.hub.addRoutes).not.toHaveBeenCalled();
  });
});
