/* eslint-disable unicorn/no-null -- null is the wire value of "none" in the published values */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { describe, expect, it } from "vitest";
import type { DeviceDirectory, DeviceTelemetry } from "../../protocol";
import { readDirectory, readTelemetry } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 § 3 / § 5.2: the tools page's link keeps a published `editor.devices`
// or `editor.deviceTelemetry` only when readDirectory / readTelemetry accept it.
// A malformed value is refused whole (the Connect panel and the cards never
// read past it); a well-formed one with unavailable readings is kept (one
// reading degrades alone).
// ─────────────────────────────────────────────────────────────────────────────

/** The demo directory: device mode on by wire, the A26 linked, a LAN phone asking. */
const DIRECTORY: DeviceDirectory = {
  v: 1,
  mode: { on: true, owner: "connect", listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null } },
  confirmIn: "page",
  adb: { available: true },
  wire: [
    {
      serial: "R5CX30ABCDE",
      state: "device",
      transport: "usb",
      model: "SM-A266B",
      name: "Galaxy A26",
      os: "Android 15",
      phase: "linked",
      device: "d-7f3a"
    }
  ],
  asking: [
    {
      ticket: "p-3a1f",
      model: "SM-A256B",
      address: "192.168.1.23",
      link: "lan",
      engine: null,
      build: null,
      since: 1_791_986_083_963
    }
  ],
  linked: [
    {
      id: "d-7f3a",
      model: "SM-A266B",
      link: "adb",
      address: "127.0.0.1",
      online: true,
      engine: "0.15.0+9c41e0",
      build: "debug-20261016T090000Z",
      latencyMs: 9,
      session: "s-9"
    }
  ],
  at: 1_791_986_083_963
};

/** The demo record: GPU and app CPU read, the renderer ambiguous, memory warming up, CDP heap with one GC. */
const TELEMETRY: DeviceTelemetry = {
  v: 1,
  device: "d-7f3a",
  serial: "R5CX30ABCDE",
  at: 1_791_986_083_963,
  wired: true,
  gpu: {
    available: true,
    source: "/sys/kernel/gpu",
    value: { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 }
  },
  cpu: {
    cores: 8,
    app: {
      available: true,
      source: "/proc/23811/stat",
      value: { pid: 23_811, name: "com.moku.garden", pct: 14.2, oneCorePct: 113.6 }
    },
    renderer: { available: false, source: "none", reason: "ambiguous" },
    surfaceflinger: {
      available: true,
      source: "/proc/612/stat",
      value: { pid: 612, name: "surfaceflinger", pct: 2.1, oneCorePct: 16.8 }
    }
  },
  memory: {
    app: { available: false, source: "dumpsys meminfo", reason: "warming-up" },
    renderer: { available: false, source: "dumpsys meminfo", reason: "warming-up" }
  },
  heap: {
    available: true,
    source: "cdp Runtime.getHeapUsage",
    value: {
      samples: [
        { t: 1_791_986_083_713, usedMb: 57, totalMb: 64 },
        { t: 1_791_986_083_963, usedMb: 31, totalMb: 64 }
      ],
      gcs: [{ t: 1_791_986_083_963, freedMb: 26, inferred: true }]
    }
  }
};

/** Marks a field the change removes. */
const GONE = Symbol("gone");

/** One part of a path into a value: a field name or an array index. */
type Key = string | number;

/**
 * A deep copy of a value with one field set or removed, as the JSON a malformed publish would carry.
 *
 * @param value - The well-formed value.
 * @param path - The fields down to the one that changes.
 * @param next - Its new value, or GONE to remove it.
 * @returns The changed copy.
 */
function changed(value: unknown, path: readonly Key[], next: unknown): unknown {
  const copy = structuredClone(value);
  let node: unknown = copy;
  for (const key of path.slice(0, -1)) {
    node = typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined;
  }
  const last = path.at(-1);
  if (typeof node !== "object" || node === null || last === undefined) throw new Error("bad path");
  if (next === GONE) Reflect.deleteProperty(node, last);
  else Reflect.set(node, last, next);
  return copy;
}

describe("readDirectory", () => {
  it("keeps a published directory with phones, an asking pairing and a linked device as it is", () => {
    expect(readDirectory(structuredClone(DIRECTORY))).toEqual(DIRECTORY);
    expect(
      readDirectory({ ...DIRECTORY, mode: { on: false, owner: null, listen: null } })
    ).toBeDefined();
  });

  it.each<[string, readonly Key[], unknown]>([
    ["another version", ["v"], 2],
    ["an unknown owner", ["mode", "owner"], "perf"],
    ["a listen without its adb address", ["mode", "listen", "adb"], GONE],
    ["an unknown confirmIn", ["confirmIn"], "phone"],
    ["a phone with an unknown phase", ["wire", 0, "phase"], "paired"],
    ["a phone without its serial", ["wire", 0, "serial"], GONE],
    ["a pairing ask without its ticket", ["asking", 0, "ticket"], GONE],
    ["a linked entry without its session field", ["linked", 0, "session"], GONE],
    ["a linked entry with a text latency", ["linked", 0, "latencyMs"], "9 ms"],
    ["no linked list", ["linked"], GONE]
  ])("refuses a directory with %s", (_name, path, next) => {
    expect(readDirectory(changed(DIRECTORY, path, next))).toBeUndefined();
  });

  it("refuses what is not an object", () => {
    for (const value of [null, [], "devices", 1]) expect(readDirectory(value)).toBeUndefined();
  });
});

describe("readTelemetry", () => {
  it("keeps a record whose readings are partly unavailable, each with its reason", () => {
    expect(readTelemetry(structuredClone(TELEMETRY))).toEqual(TELEMETRY);
  });

  it.each<[string, readonly Key[], unknown]>([
    ["an available reading without its value", ["gpu", "value"], GONE],
    ["an unavailable reading with an unknown reason", ["cpu", "renderer", "reason"], "busy"],
    ["a reading without its source", ["cpu", "app", "source"], GONE],
    ["a GPU clock as text", ["gpu", "value", "mhz"], "221 MHz"],
    ["no surfaceflinger reading", ["cpu", "surfaceflinger"], GONE],
    ["a heap sample without usedMb", ["heap", "value", "samples", 1, "usedMb"], GONE],
    ["a GC without its inferred flag", ["heap", "value", "gcs", 0, "inferred"], GONE],
    ["no wired flag", ["wired"], GONE]
  ])("refuses a record with %s", (_name, path, next) => {
    expect(readTelemetry(changed(TELEMETRY, path, next))).toBeUndefined();
  });
});
