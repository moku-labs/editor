/* eslint-disable unicorn/no-null, sonarjs/no-hardcoded-ip -- null is "no model" on the wire; addresses are the cases under test */
import { describe, expect, it } from "vitest";
import {
  baseAppId,
  isLoopback,
  normalizeModel,
  parseAddress,
  parsePairParams,
  parsePerfLinesParams
} from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// The pure helpers of hub/protocol (C8). Each test name says the bug it
// catches; the test asserts the opposite.
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeModel", () => {
  it("adb's SM_A266B-style spaces and case never match the page's SM-A266B", () => {
    expect(normalizeModel(" sm a266b ")).toBe("SM-A266B");
    expect(normalizeModel("Pixel\t 8   Pro")).toBe("PIXEL-8-PRO");
  });

  it("an empty, blank or non-string model is reported as a model", () => {
    expect(normalizeModel("")).toBeNull();
    expect(normalizeModel("   ")).toBeNull();
    expect(normalizeModel(42)).toBeNull();
    expect(normalizeModel(undefined)).toBeNull();
  });

  it("a 65-character model is kept whole", () => {
    expect(normalizeModel("a".repeat(65))).toBe("A".repeat(64));
  });
});

describe("parsePairParams", () => {
  it("a five-digit or three-digit code passes", () => {
    expect(parsePairParams({ code: "48211", device: {} })).toBeUndefined();
    expect(parsePairParams({ code: "482", device: {} })).toBeUndefined();
    expect(parsePairParams({ code: "48a1", device: {} })).toBeUndefined();
    expect(parsePairParams({ code: 4821, device: {} })).toBeUndefined();
  });

  it("a leading zero of the code is lost", () => {
    expect(parsePairParams({ code: "0421", device: {} })).toEqual({ code: "0421", device: {} });
  });

  it("a non-object device passes, and non-string device fields reach the hub", () => {
    expect(parsePairParams({ code: "4821", device: "SM-A266B" })).toBeUndefined();
    expect(parsePairParams({ code: "4821", device: null })).toBeUndefined();
    expect(parsePairParams({ code: "4821" })).toBeUndefined();
    expect(parsePairParams(null)).toBeUndefined();
    expect(
      parsePairParams({
        code: "4821",
        device: { model: "SM-A266B", os: 15, engine: "0.14.12+9c41e0", build: null, extra: "x" }
      })
    ).toEqual({ code: "4821", device: { model: "SM-A266B", engine: "0.14.12+9c41e0" } });
  });
});

describe("parsePerfLinesParams", () => {
  const LOG = "perf-20261014-1532-sm-a266b.jsonl";

  it("a well-formed batch of one to 5000 lines is refused", () => {
    expect(parsePerfLinesParams({ log: LOG, from: 0, lines: [{ v: 1 }] })).toEqual({
      log: LOG,
      from: 0,
      lines: [{ v: 1 }]
    });
    expect(
      parsePerfLinesParams({ log: LOG, from: 7, lines: Array(5000).fill(1) })?.lines
    ).toHaveLength(5000);
  });

  it("a bad log name, a negative or fractional from, an empty or 5001-line batch passes", () => {
    for (const log of ["", "a/b.jsonl", "x".repeat(129), 5]) {
      expect(parsePerfLinesParams({ log, from: 0, lines: [1] })).toBeUndefined();
    }
    for (const from of [-1, 1.5, "0", 2 ** 53]) {
      expect(parsePerfLinesParams({ log: LOG, from, lines: [1] })).toBeUndefined();
    }
    expect(parsePerfLinesParams({ log: LOG, from: 0, lines: [] })).toBeUndefined();
    expect(parsePerfLinesParams({ log: LOG, from: 0, lines: Array(5001).fill(1) })).toBeUndefined();
    expect(parsePerfLinesParams({ log: LOG, from: 0, lines: { 0: 1 } })).toBeUndefined();
    expect(parsePerfLinesParams(undefined)).toBeUndefined();
  });
});

describe("parseAddress", () => {
  it("a port above 65535 is accepted", () => {
    expect(parseAddress("192.168.1.5:65536")).toBeUndefined();
    expect(parseAddress("192.168.1.5:0")).toBeUndefined();
    expect(parseAddress("192.168.1.5:123456")).toBeUndefined();
    expect(parseAddress("192.168.1.5:65535")?.port).toBe(65_535);
  });

  it("a host without a port is accepted", () => {
    expect(parseAddress("192.168.1.5")).toBeUndefined();
    expect(parseAddress("192.168.1.5:")).toBeUndefined();
    expect(parseAddress(":47600")).toBeUndefined();
  });

  it("IPv6 in brackets is refused", () => {
    expect(parseAddress("[::1]:47600")).toEqual({ host: "::1", port: 47_600, text: "[::1]:47600" });
    expect(parseAddress("[FE80::1]:47600")?.text).toBe("[fe80::1]:47600");
    expect(parseAddress("::1:47600")).toBeUndefined();
    expect(parseAddress("[::1]47600")).toBeUndefined();
    expect(parseAddress("[nope]:47600")).toBeUndefined();
  });

  it("spaces around the text break the match", () => {
    expect(parseAddress(" 192.168.1.5:47600 ")).toEqual({
      host: "192.168.1.5",
      port: 47_600,
      text: "192.168.1.5:47600"
    });
  });

  it("a malformed host or an IPv4 literal out of range is accepted", () => {
    expect(parseAddress("192.168.1.300:47600")).toBeUndefined();
    expect(parseAddress("192.168.1:47600")).toBeUndefined();
    expect(parseAddress("-pc.local:47600")).toBeUndefined();
    expect(parseAddress("my pc:47600")).toBeUndefined();
    expect(parseAddress("My-PC.local:07600")).toEqual({
      host: "my-pc.local",
      port: 7600,
      text: "my-pc.local:7600"
    });
  });
});

describe("isLoopback", () => {
  it("127.0.0.2 counts as LAN", () => {
    expect(isLoopback("127.0.0.2")).toBe(true);
    expect(isLoopback("127.255.255.254")).toBe(true);
  });

  it("localhost and ::1 count as LAN, and LAN addresses as loopback", () => {
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("LocalHost")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    for (const host of ["192.168.1.5", "128.0.0.1", "10.0.0.1", "127.0.0.300", "fe80::1"]) {
      expect(isLoopback(host)).toBe(false);
    }
  });
});

describe("pairing text is clean (review fix 1)", () => {
  /** Control and bidi characters a phone could hide in its pair: C0, DEL, C1, overrides, isolates. */
  const UNSAFE = [
    "\u0000",
    "\u0007",
    "\n",
    "\u001B[31m",
    "\u007F",
    "\u0085",
    "\u009B",
    "\u202A",
    "\u202E",
    "\u2066",
    "\u2069"
  ];

  it("a control or bidi character in model, os, engine or build reaches the confirm prompt and the logs", () => {
    for (const field of ["model", "os", "engine", "build"]) {
      for (const bad of UNSAFE) {
        const device = { [field]: `SM-A266B${bad}x` };
        expect({ field, bad, parsed: parsePairParams({ code: "4821", device }) }).toEqual({
          field,
          bad,
          parsed: undefined
        });
      }
    }
  });

  it("a model, os, engine or build over 128 characters passes", () => {
    for (const field of ["model", "os", "engine", "build"]) {
      expect(
        parsePairParams({ code: "4821", device: { [field]: "a".repeat(129) } })
      ).toBeUndefined();
      expect(
        parsePairParams({ code: "4821", device: { [field]: "a".repeat(128) } })?.device
      ).toEqual({
        [field]: "a".repeat(128)
      });
    }
    expect(
      parsePairParams({ code: "4821", device: { os: "Android 15 · ünïcode" } })?.device
    ).toEqual({
      os: "Android 15 · ünïcode"
    });
  });

  it("normalizeModel keeps control and bidi characters in the model", () => {
    expect(normalizeModel("SM\u202E-A266B\u0007")).toBe("SM-A266B");
    expect(normalizeModel("\u001B[31mPixel 8\u0085")).toBe("[31MPIXEL-8");
    expect(normalizeModel("\u2066\u0000")).toBeNull();
    expect(normalizeModel("SM-A266B\n")).toBe("SM-A266B");
  });
});

describe("the app id of a pair (spec 07 B, engine E3)", () => {
  it("keeps a clean app id and refuses a pair whose app id hides a bidi override or runs over 128", () => {
    // Bug: a crafted app id rewriting the terminal's pairing question or a log line.
    expect(
      parsePairParams({ code: "4821", device: { appId: "com.mokulabs.timber.debug" } })?.device
    ).toEqual({ appId: "com.mokulabs.timber.debug" });
    expect(parsePairParams({ code: "4821", device: { appId: "com.x\u202Egame" } })).toBeUndefined();
    expect(parsePairParams({ code: "4821", device: { appId: "a".repeat(129) } })).toBeUndefined();
    expect(parsePairParams({ code: "4821", device: { appId: 7 } })?.device).toEqual({});
  });

  it("baseAppId strips one trailing .debug, so a debug install pairs with its project", () => {
    // Bug: com.mokulabs.timber.debug never matching the project's com.mokulabs.timber.
    expect(baseAppId("com.mokulabs.timber.debug")).toBe("com.mokulabs.timber");
    expect(baseAppId("com.mokulabs.timber")).toBe("com.mokulabs.timber");
    expect(baseAppId("com.debug.timber")).toBe("com.debug.timber");
    expect(baseAppId("com.mokulabs.timberdebug")).toBe("com.mokulabs.timberdebug");
  });
});
