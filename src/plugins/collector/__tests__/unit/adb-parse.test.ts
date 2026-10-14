/* eslint-disable unicorn/no-null -- null is "not read" in the parsers' answers */
import { describe, expect, it } from "vitest";
import {
  gfxPercentile,
  parseBattery,
  parseDevices,
  parseGfx,
  parseModel,
  parsePackages,
  parseThermal,
  spanOf
} from "../../adb/parse";

// ─────────────────────────────────────────────────────────────────────────────
// The pure adb parsers: the game's examples still hold, plus the device-id and
// duplicate-phone fixes.
// ─────────────────────────────────────────────────────────────────────────────

describe("parseDevices", () => {
  it("keeps ready devices only and drops the _adb-tls twin and unauthorized entries (bug: the same phone twice)", () => {
    const text = [
      "List of devices attached",
      "R5CX30ABCDE\tdevice",
      "adb-R5CX30ABCDE-xyz._adb-tls-connect._tcp\tdevice",
      "emulator-5554\tunauthorized",
      "192.168.2.67:43621\tdevice",
      ""
    ].join("\n");

    expect(parseDevices(text)).toEqual(["R5CX30ABCDE", "192.168.2.67:43621"]);
  });
});

describe("parseModel", () => {
  it("normalizes getprop's model like the page's header (bug: SM_A266B vs SM-A266B)", () => {
    expect(parseModel("SM-A266B\n")).toBe("SM-A266B");
    expect(parseModel(" pixel 8 pro \n")).toBe("PIXEL-8-PRO");
    expect(parseModel("\n")).toBeNull();
  });
});

describe("parseBattery", () => {
  it("reads the temperature line in tenths of a degree", () => {
    expect(parseBattery("  level: 48\n  temperature: 351\n")).toBe(35.1);
    expect(parseBattery("  level: 48\n")).toBeNull();
  });

  it("does not read Samsung's history values inside longer lines", () => {
    expect(parseBattery("  mSavedBatteryTemperature: 400 temperature: 390\n")).toBeNull();
  });
});

describe("parseThermal", () => {
  it("reads the status and the HAL sensors", () => {
    const text = [
      "Thermal Status: 1",
      "Current temperatures from HAL:",
      "\tTemperature{mValue=38.4, mType=3, mName=SKIN, mStatus=1}",
      "\tTemperature{mValue=45.9, mType=0, mName=AP, mStatus=0}",
      "Cached temperatures:",
      "\tTemperature{mValue=30.0, mType=3, mName=OLD, mStatus=0}"
    ].join("\n");

    expect(parseThermal(text)).toEqual({ status: 1, sensors: { SKIN: 38.4, AP: 45.9 } });
  });

  it("uses the cached block only when the HAL block has no reading, and leaves a 0 sensor out", () => {
    const text = [
      "Thermal Status: 0",
      "Current temperatures from HAL:",
      "Cached temperatures:",
      "\tTemperature{mValue=36.1, mType=3, mName=SKIN, mStatus=0}",
      "\tTemperature{mValue=0.0, mType=2, mName=BAT, mStatus=0}"
    ].join("\n");

    expect(parseThermal(text)).toEqual({ status: 0, sensors: { SKIN: 36.1 } });
  });

  it("answers null status and no sensors for an unknown text", () => {
    expect(parseThermal("nothing")).toEqual({ status: null, sensors: {} });
  });
});

describe("parsePackages", () => {
  it("prefers the .debug package, else the store package, else null", () => {
    const both = "package:com.example.garden\npackage:com.example.garden.debug\n";

    expect(parsePackages(both, "com.example.garden")).toBe("com.example.garden.debug");
    expect(parsePackages("package:com.example.garden\n", "com.example.garden")).toBe(
      "com.example.garden"
    );
    expect(parsePackages("package:com.example.gardenia\n", "com.example.garden")).toBeNull();
  });
});

describe("parseGfx, gfxPercentile, spanOf", () => {
  it("reads the gfxinfo totals, and undefined while the app does not run", () => {
    const text =
      "Total frames rendered: 45230\nJanky frames: 10663 (23.57%)\nHISTOGRAM: 5ms=4171 6ms=807\n";

    expect(parseGfx(text)).toEqual({
      frames: 45_230,
      janky: 10_663,
      histogram: new Map([
        [5, 4171],
        [6, 807]
      ])
    });
    expect(parseGfx("No process found for: com.example.garden\n")).toBeUndefined();
  });

  it("takes the game's percentile: the first bucket whose running count reaches the share", () => {
    expect(
      gfxPercentile(
        [
          [16, 90],
          [40, 10]
        ],
        0.95
      )
    ).toBe(40);
    expect(
      gfxPercentile(
        [
          [40, 10],
          [16, 90]
        ],
        0.5
      )
    ).toBe(16);
    expect(gfxPercentile([], 0.5)).toBe(0);
  });

  it("gives the frames between two readings, and counts from zero after an app restart", () => {
    const before = { frames: 1000, janky: 100, histogram: new Map([[16, 1000]]) };
    const after = {
      frames: 1412,
      janky: 196,
      histogram: new Map([
        [16, 1300],
        [33, 112]
      ])
    };
    const restarted = { frames: 300, janky: 3, histogram: new Map([[16, 300]]) };

    expect(spanOf(before, after, 10)).toEqual({
      frames: 412,
      janky: 96,
      fps: 41.2,
      p50: 16,
      p90: 33,
      p99: 33,
      hist: [
        [16, 300],
        [33, 112]
      ]
    });
    expect(spanOf(after, restarted, 10)).toMatchObject({ frames: 300, janky: 3, fps: 30 });
  });
});
