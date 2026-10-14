/* eslint-disable unicorn/no-null -- null is "not measured" in the log lines and summaries */
import { existsSync } from "node:fs";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAdb } from "../../adb/run";
import { createCollectorApi } from "../../api";
import { createCollectorHooks } from "../../handlers";
import { stopCollector } from "../../lifecycle";
import type { CollectorHooks } from "../../types";
import type { TestCtx } from "../helpers";
import {
  createCtx,
  deviceOf,
  fileLines,
  headerLine,
  linesEvent,
  removeDir,
  sampleLine,
  tempDir
} from "../helpers";

vi.mock("../../adb/run", () => ({
  runAdb: vi.fn(async () => ({ code: 0, text: "List of devices attached\n", missing: false }))
}));

// ─────────────────────────────────────────────────────────────────────────────
// The hub:device handler with a mock ctx: idle until listening, one file per
// device log, away and back to the same file, done on stopped, the throttled
// collector:session, nothing after stop.
// ─────────────────────────────────────────────────────────────────────────────

let root: string;
let ctx: TestCtx;
let hooks: CollectorHooks;

/**
 * Lets every log queue finish.
 */
async function drain(): Promise<void> {
  await Promise.all([...ctx.state.sessions.values()].map(session => session.queue));
}

/**
 * The collector:session payloads emitted so far.
 *
 * @returns The payloads.
 */
function emitted() {
  return ctx.emit.mock.calls.map(([, payload]) => payload);
}

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
  vi.setSystemTime(new Date(2026, 9, 14, 15, 32));
  vi.mocked(runAdb).mockClear();
  root = await tempDir();
  ctx = createCtx(root);
  hooks = createCollectorHooks(ctx);
});

afterEach(async () => {
  await stopCollector(ctx);
  vi.useRealTimers();
  await removeDir(root);
});

describe("hub:device", () => {
  it("runs nothing (no timer, no process, no file) before listening, then starts the adb loop", async () => {
    createCollectorApi(ctx).sessions();

    expect(vi.getTimerCount()).toBe(0);
    expect(runAdb).not.toHaveBeenCalled();
    expect(existsSync(join(root, ".moku"))).toBe(false);

    hooks["hub:device"]({
      kind: "listening",
      listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null }
    });

    expect(vi.getTimerCount()).toBe(2);
    expect(ctx.state.adb?.port).toBe(47_600);
    expect(runAdb).toHaveBeenCalledWith("adb", ["devices"], 5000);
  });

  it("opens one file per device log, named from the header's model, under out", async () => {
    const device = deviceOf({ model: null });
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)]));
    hooks["hub:device"](linesEvent(device, [sampleLine(2000)], { from: 2 }));
    hooks["hub:device"](linesEvent(device, [sampleLine(3000)], { log: "perf-2.jsonl" }));
    await drain();

    const files = [...ctx.state.sessions.values()].map(session => session.file);
    expect(files).toEqual([
      join(root, ".moku/perf/perf-20261014-1532-sm-a266b.jsonl"),
      join(root, ".moku/perf/perf-20261014-1532-device.jsonl")
    ]);
    const written = await fileLines(files[0] ?? "");
    expect(written.map(line => line.t)).toEqual([0, 1000, 2000]);
  });

  it("marks a log away when its device leaves and appends to the same file when it comes back (bug: a Wi-Fi drop splitting a recording)", async () => {
    const device = deviceOf();
    hooks["hub:device"]({ kind: "connected", device });
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)]));
    await drain();
    hooks["hub:device"]({ kind: "closed", device: { ...device, online: false }, reason: "lost" });
    await drain();

    const [session] = ctx.state.sessions.values();
    expect(session?.state).toBe("away");
    expect(session?.handle).toBeUndefined();
    expect(emitted().at(-1)).toMatchObject({ state: "away", lines: 2 });

    hooks["hub:device"]({ kind: "connected", device });
    expect(session?.state).toBe("live");
    hooks["hub:device"](linesEvent(device, [sampleLine(2000)], { from: 2 }));
    await drain();

    expect(ctx.state.sessions.size).toBe(1);
    const written = await fileLines(session?.file ?? "");
    expect(written.map(line => line.t)).toEqual([0, 1000, 2000]);
  });

  it("marks every log done and stops the adb loop on stopped", async () => {
    const device = deviceOf();
    hooks["hub:device"]({
      kind: "listening",
      listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null }
    });
    hooks["hub:device"](linesEvent(device, [sampleLine(1000)]));
    hooks["hub:device"]({ kind: "stopped" });
    await drain();

    expect(ctx.state.adb).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(
      createCollectorApi(ctx)
        .sessions()
        .map(session => session.state)
    ).toEqual(["done"]);
    expect(emitted().at(-1)).toMatchObject({ state: "done" });
  });

  it("emits collector:session at once on the first batch, then at most once a second with the newest counts", async () => {
    const device = deviceOf();
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)]));
    await drain();
    expect(emitted()).toHaveLength(1);
    expect(emitted()[0]).toMatchObject({ device, state: "live", lines: 2, lost: 0 });
    expect(emitted()[0]?.last).toMatchObject({ t: 1000, path: "garden/boss", fps: 118 });

    await vi.advanceTimersByTimeAsync(300);
    hooks["hub:device"](linesEvent(device, [sampleLine(2000)], { from: 2 }));
    await drain();
    await vi.advanceTimersByTimeAsync(300);
    hooks["hub:device"](linesEvent(device, [sampleLine(3000)], { from: 3, gap: 1 }));
    await drain();
    expect(emitted()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(emitted()).toHaveLength(2);
    expect(emitted()[1]).toMatchObject({ lines: 5, lost: 1 });
    expect(emitted()[1]?.last).toMatchObject({ t: 3000 });
  });

  it("writes and emits nothing for a hub:device after stop", async () => {
    await stopCollector(ctx);

    hooks["hub:device"](linesEvent(deviceOf(), [sampleLine(1000)]));
    hooks["hub:device"]({
      kind: "listening",
      listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null }
    });

    expect(ctx.state.sessions.size).toBe(0);
    expect(ctx.state.adb).toBeUndefined();
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(existsSync(join(root, ".moku"))).toBe(false);
  });
});

describe("hub:device — limits and order", () => {
  it("closes the file of a device's other logs when it starts a new one, and reopens it on its next line (bug: a phone holding open files)", async () => {
    const device = deviceOf();
    hooks["hub:device"](linesEvent(device, [sampleLine(1000)]));
    await drain();
    hooks["hub:device"](linesEvent(device, [sampleLine(2000)], { log: "perf-2.jsonl" }));
    await drain();

    const [first, second] = ctx.state.sessions.values();
    expect(first?.handle).toBeUndefined();
    expect(second?.handle).toBeDefined();

    hooks["hub:device"](linesEvent(device, [sampleLine(3000)], { from: 1 }));
    await drain();
    expect(first?.handle).toBeDefined();
    const written = await fileLines(first?.file ?? "");
    expect(written.map(line => line.t)).toEqual([1000, 3000]);
  });

  it("refuses a 33rd live log of one device, counts its lines lost and warns once (bug: a phone creating files without end)", async () => {
    const device = deviceOf();
    for (let index = 0; index < 32; index += 1) {
      hooks["hub:device"](linesEvent(device, [sampleLine(index)], { log: `log-${index}.jsonl` }));
    }
    hooks["hub:device"](
      linesEvent(device, [sampleLine(100), sampleLine(101)], { log: "log-32.jsonl" })
    );
    hooks["hub:device"](linesEvent(device, [sampleLine(102)], { log: "log-32.jsonl", from: 2 }));
    await drain();

    expect(ctx.state.sessions.size).toBe(32);
    expect(ctx.state.refused.get(device.id)).toBe(3);
    const warned = ctx.log.warn.mock.calls.filter(([event]) => event === "collector:log-cap");
    expect(warned).toEqual([
      ["collector:log-cap", { device: device.id, log: "log-32.jsonl", cap: 32 }]
    ]);
  });

  it("emits away then live when the device's connection is replaced by a new one", async () => {
    const device = deviceOf();
    hooks["hub:device"]({ kind: "connected", device });
    hooks["hub:device"](linesEvent(device, [sampleLine(1000)]));
    await drain();
    hooks["hub:device"]({
      kind: "closed",
      device: { ...device, online: false },
      reason: "replaced"
    });
    hooks["hub:device"]({ kind: "connected", device });
    await drain();

    expect(emitted().map(event => event.state)).toEqual(["live", "away", "live"]);
  });
});
