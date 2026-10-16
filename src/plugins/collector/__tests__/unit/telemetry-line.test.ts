/* eslint-disable unicorn/no-null -- null is "not known" in the telemetry records and log lines */
import { existsSync } from "node:fs";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceTelemetry } from "../../../connect/protocol";
import { createCollectorHooks } from "../../handlers";
import { stopCollector } from "../../lifecycle";
import { telemetryLineOf } from "../../session/telemetry";
import type { CollectorHooks, LogSession } from "../../types";
import type { TestCtx } from "../helpers";
import {
  createCtx,
  deviceOf,
  eventLine,
  fileLines,
  headerLine,
  LOG,
  linesEvent,
  removeDir,
  sampleLine,
  tempDir
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// connect:telemetry → one computer-side `telemetry` line in the device's live,
// recording log: the record's fields verbatim, `t` on the log's page clock,
// `rx`; nothing for a device without a live log, after its recorder stop line
// or after onStop.
// ─────────────────────────────────────────────────────────────────────────────

/** Computer epoch ms of the fixtures' first batch. */
const RX = 1_791_986_090_000;

/** The session key of the fixtures' device log. */
const KEY = `d-7f3a/${LOG}`;

let root: string;
let ctx: TestCtx;
let hooks: CollectorHooks;

/**
 * One wired telemetry record of the fixtures' A26 (connect's shape, 11 § 3 Wire types): GPU and
 * surfaceflinger read, the app's CPU, the memory and the heap not available with their reasons.
 *
 * @param overrides - Fields to change.
 * @returns The record.
 */
function telemetryRecord(overrides: Partial<DeviceTelemetry> = {}): DeviceTelemetry {
  return {
    v: 1,
    device: "d-7f3a",
    serial: "R5CX30ABCDE",
    at: RX + 500,
    wired: true,
    gpu: {
      available: true,
      source: "/sys/kernel/gpu",
      value: { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 }
    },
    cpu: {
      cores: 8,
      app: { available: false, source: "none", reason: "not-found" },
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
    heap: { available: false, source: "none", reason: "no-devtools-socket" },
    ...overrides
  };
}

/**
 * Lets every log queue finish.
 */
async function drain(): Promise<void> {
  await Promise.all([...ctx.state.sessions.values()].map(session => session.queue));
}

/**
 * The session of a log.
 *
 * @param key - `${device id}/${log}`.
 * @returns The session.
 */
function sessionOf(key: string): LogSession {
  const session = ctx.state.sessions.get(key);
  if (session === undefined) throw new Error(`no session ${key}`);
  return session;
}

/**
 * The telemetry lines of a log's file.
 *
 * @param session - The log.
 * @returns Its telemetry lines, parsed.
 */
async function telemetryLines(session: LogSession) {
  const lines = await fileLines(session.file);
  return lines.filter(line => line.kind === "telemetry");
}

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32));
  root = await tempDir();
  ctx = createCtx(root);
  hooks = createCollectorHooks(ctx);
});

afterEach(async () => {
  await stopCollector(ctx);
  vi.useRealTimers();
  await removeDir(root);
});

describe("connect:telemetry", () => {
  it("writes one telemetry line into the device's live recording log: rx, t on the page clock, the readings verbatim with their sources and reasons (bug: the phone's telemetry missing from the log the owner reads back; bug: 'not available' turned into 0 MHz)", async () => {
    const device = deviceOf();
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)], { rx: RX }));
    vi.setSystemTime(RX + 1000);
    const record = telemetryRecord();

    hooks["connect:telemetry"](record);
    await drain();

    const session = sessionOf(KEY);
    expect(await telemetryLines(session)).toEqual([
      {
        v: 1,
        kind: "telemetry",
        // offset = max(t − rx) = 1000 − RX, so the record's RX + 500 is page t 1500.
        t: 1500,
        rx: RX + 1000,
        build: "debug-1",
        device: "SM-A266B",
        serial: "R5CX30ABCDE",
        wired: true,
        gpu: record.gpu,
        cpu: record.cpu,
        memory: record.memory,
        heap: record.heap
      }
    ]);
    const [line] = await telemetryLines(session);
    expect(line?.heap).toEqual({ available: false, source: "none", reason: "no-devtools-socket" });
    expect(session.lines).toBe(3);
  });

  it("writes nothing after the log's recorder stop line, and again after a start line (bug: telemetry written into a log nobody records)", async () => {
    const device = deviceOf();
    const start = { action: "start", label: "boss", by: "phone", name: null };
    hooks["hub:device"](
      linesEvent(device, [headerLine(0), eventLine(10, "recorder", start), sampleLine(1000)])
    );
    hooks["hub:device"](
      linesEvent(device, [eventLine(2000, "recorder", { action: "stop" })], { from: 3 })
    );

    hooks["connect:telemetry"](telemetryRecord());
    await drain();

    const session = sessionOf(KEY);
    expect(await telemetryLines(session)).toEqual([]);

    hooks["hub:device"](linesEvent(device, [eventLine(3000, "recorder", start)], { from: 4 }));
    hooks["connect:telemetry"](telemetryRecord());
    await drain();

    expect(await telemetryLines(session)).toHaveLength(1);
  });

  it("creates no file for a device without a log and writes nothing into a log that is away (bug: a file created for a phone that is not recording)", async () => {
    hooks["connect:telemetry"](telemetryRecord());
    await drain();

    expect(ctx.state.sessions.size).toBe(0);
    expect(existsSync(join(root, ".moku"))).toBe(false);

    const device = deviceOf();
    hooks["hub:device"]({ kind: "connected", device });
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)]));
    hooks["hub:device"]({ kind: "closed", device: { ...device, online: false }, reason: "lost" });
    hooks["connect:telemetry"](telemetryRecord());
    await drain();

    const session = sessionOf(KEY);
    expect(session.state).toBe("away");
    expect(await telemetryLines(session)).toEqual([]);
    expect(session.lines).toBe(2);
  });

  it("writes into the device's newest live log when two are open around a rotation (bug: the telemetry of the new recording written into the finished log)", async () => {
    const device = deviceOf();
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)]));
    await drain();
    hooks["hub:device"](linesEvent(device, [headerLine(0)], { log: "perf-2.jsonl" }));
    await drain();
    vi.advanceTimersByTime(1500);
    hooks["hub:device"](linesEvent(device, [sampleLine(2000)], { log: "perf-2.jsonl", from: 1 }));
    await drain();

    hooks["connect:telemetry"](telemetryRecord());
    await drain();

    const first = sessionOf(KEY);
    const second = sessionOf("d-7f3a/perf-2.jsonl");
    expect(first.state).toBe("live");
    expect(await telemetryLines(first)).toEqual([]);
    expect(await telemetryLines(second)).toHaveLength(1);
  });

  it("writes nothing after onStop", async () => {
    const device = deviceOf();
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)]));
    await drain();
    await stopCollector(ctx);

    hooks["connect:telemetry"](telemetryRecord());
    await drain();

    const session = sessionOf(KEY);
    expect(await telemetryLines(session)).toEqual([]);
    expect(session.lines).toBe(2);
  });
});

describe("telemetryLineOf", () => {
  it("puts t at the write moment rx while the log has no page clock yet (bug: a telemetry line on another clock than the log's other collector lines)", () => {
    const line = telemetryLineOf(
      telemetryRecord({ at: RX + 500 }),
      { offset: null, build: null, model: "SM-A266B" },
      RX + 700
    );

    expect(line).toMatchObject({ t: RX + 700, rx: RX + 700, build: null, device: "SM-A266B" });
  });
});
